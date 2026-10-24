const ignoredKeys = new Set([
  "comments",
  "end",
  "innerComments",
  "leadingComments",
  "loc",
  "parent",
  "range",
  "raw",
  "start",
  "tokens",
  "trailingComments",
]);

function fields(value) {
  return Object.keys(value)
    .filter((key) => !ignoredKeys.has(key))
    .toSorted();
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;

  if (value.type === "Literal") {
    if (value.regex) return { type: value.type, regex: normalize(value.regex) };
    if (value.bigint !== undefined) return { type: value.type, bigint: value.bigint };

    const valueType = value.value === null ? "null" : typeof value.value;
    return { type: value.type, valueType };
  }

  return Object.fromEntries(fields(value).map((key) => [key, normalize(value[key])]));
}

function visitAst(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) visitAst(item, visitor);
    return;
  }

  if (value === null || typeof value !== "object") return;
  if (typeof value.type === "string") visitor(value);

  for (const key of fields(value)) visitAst(value[key], visitor);
}

function isPrimitiveLiteral(node) {
  return (
    node.type === "Literal" &&
    !node.regex &&
    node.bigint === undefined &&
    (node.value === null || ["string", "number", "boolean"].includes(typeof node.value))
  );
}

function collectLiteralValues(node) {
  const values = [];
  visitAst(node, (child) => {
    if (isPrimitiveLiteral(child)) {
      const valueType = child.value === null ? "null" : typeof child.value;
      values.push(JSON.stringify([valueType, child.value]));
    }
  });
  return values;
}

function hasVaryingLiteralValues(callbacks) {
  const literalValues = callbacks.map((callback) => collectLiteralValues(callback.body));
  if (literalValues.length < 2 || literalValues[0].length === 0) return false;

  return literalValues[0].some((value, index) =>
    literalValues.slice(1).some((values) => values[index] !== value),
  );
}

function containsNode(node, predicate) {
  let found = false;
  visitAst(node, (child) => {
    if (predicate(child)) found = true;
  });
  return found;
}

function isExpectationCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "expect"
  );
}

function hasExplicitSideEffect(node) {
  return containsNode(
    node,
    (child) =>
      [
        "AssignmentExpression",
        "AwaitExpression",
        "NewExpression",
        "ThrowStatement",
        "UpdateExpression",
        "YieldExpression",
      ].includes(child.type) ||
      (child.type === "UnaryExpression" && child.operator === "delete"),
  );
}

function isSimpleExpectationCallback(callback) {
  if (callback.async || callback.generator) return false;

  let expression;
  if (callback.body.type === "BlockStatement") {
    if (callback.body.body.length !== 1 || callback.body.body[0].type !== "ExpressionStatement") {
      return false;
    }
    expression = callback.body.body[0].expression;
  } else {
    expression = callback.body;
  }

  if (expression.type !== "CallExpression") return false;
  if (hasExplicitSideEffect(expression)) return false;
  if (
    containsNode(
      expression,
      (node) =>
        node !== expression &&
        ["ArrowFunctionExpression", "FunctionExpression"].includes(node.type),
    )
  ) {
    return false;
  }

  return containsNode(expression, isExpectationCall);
}

function getImportedNames(program, importedName) {
  const names = new Set();
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== "vitest" ||
      statement.importKind === "type"
    ) {
      continue;
    }

    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") {
        continue;
      }

      const name = specifier.imported.name ?? specifier.imported.value;
      if (name === importedName) names.add(specifier.local.name);
    }
  }
  return names;
}

function getCallExpression(statement) {
  if (statement.type !== "ExpressionStatement" || statement.expression.type !== "CallExpression") {
    return null;
  }
  return statement.expression;
}

function getInlineCallback(call, importedNames, requireStaticTitle) {
  if (
    call.callee.type !== "Identifier" ||
    !importedNames.has(call.callee.name) ||
    (requireStaticTitle &&
      (call.arguments[0]?.type !== "Literal" || typeof call.arguments[0].value !== "string"))
  ) {
    return null;
  }

  const callback = call.arguments[1];
  if (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") {
    return null;
  }

  return callback;
}

const preferTableDrivenTests = {
  meta: {
    type: "suggestion",
    docs: {
      description: "suggest table-driven tests for structurally identical Vitest cases",
    },
    schema: [],
    messages: {
      preferEach:
        "Tests in this describe share the same body structure with different literal values; consider it.each() or test.each().",
    },
  },

  create(context) {
    return {
      "Program:exit"(program) {
        const describeNames = getImportedNames(program, "describe");
        const testNames = new Set([
          ...getImportedNames(program, "it"),
          ...getImportedNames(program, "test"),
        ]);
        if (describeNames.size === 0 || testNames.size === 0) return;

        visitAst(program, (node) => {
          if (
            node.type !== "CallExpression" ||
            node.callee.type !== "Identifier" ||
            !describeNames.has(node.callee.name)
          ) {
            return;
          }

          const describeCallback = node.arguments[1];
          if (
            (describeCallback?.type !== "ArrowFunctionExpression" &&
              describeCallback?.type !== "FunctionExpression") ||
            describeCallback.body.type !== "BlockStatement"
          ) {
            return;
          }

          const groups = new Map();
          for (const statement of describeCallback.body.body) {
            const testCall = getCallExpression(statement);
            if (!testCall) continue;

            const callback = getInlineCallback(testCall, testNames, true);
            if (!callback || !isSimpleExpectationCallback(callback)) continue;

            const signature = JSON.stringify(normalize(callback.body));
            const group = groups.get(signature) ?? [];
            group.push({ callback, call: testCall });
            groups.set(signature, group);
          }

          for (const group of groups.values()) {
            if (
              group.length < 2 ||
              !hasVaryingLiteralValues(group.map(({ callback }) => callback))
            ) {
              continue;
            }

            context.report({ node: group[1].call, messageId: "preferEach" });
          }
        });
      },
    };
  },
};

export default {
  meta: { name: "miharu" },
  rules: {
    "prefer-table-driven-tests": preferTableDrivenTests,
  },
};
