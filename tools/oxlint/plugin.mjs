const nodeFields = {
  ArrayExpression: ["elements"],
  BinaryExpression: ["operator", "left", "right"],
  BlockStatement: ["body"],
  CallExpression: ["optional", "callee", "arguments", "typeArguments"],
  ChainExpression: ["expression"],
  ConditionalExpression: ["test", "consequent", "alternate"],
  ExpressionStatement: ["expression"],
  Identifier: ["name"],
  LogicalExpression: ["operator", "left", "right"],
  MemberExpression: ["computed", "optional", "object", "property"],
  ObjectExpression: ["properties"],
  Property: ["computed", "kind", "method", "shorthand", "key", "value"],
  SequenceExpression: ["expressions"],
  SpreadElement: ["argument"],
  TemplateLiteral: ["quasis", "expressions"],
  UnaryExpression: ["operator", "prefix", "argument"],
};

const mutatingMethods = new Set([
  "add",
  "clear",
  "copyWithin",
  "delete",
  "fill",
  "pop",
  "push",
  "reverse",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);
const unsupported = Symbol("unsupported AST");

function variableFor(identifier, sourceCode) {
  for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set?.get(identifier.name);
    if (variable) return variable;
  }
  return null;
}

function importedBindings(program, sourceCode) {
  const bindings = { describe: new Set(), tests: new Set(), expect: new Set() };

  for (const declaration of program.body) {
    if (
      declaration.type !== "ImportDeclaration" ||
      declaration.source.value !== "vitest" ||
      declaration.importKind === "type"
    ) {
      continue;
    }

    for (const specifier of declaration.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
      const name = specifier.imported.name ?? specifier.imported.value;
      const variable = sourceCode.getDeclaredVariables(specifier)[0];
      if (!variable) continue;

      if (name === "describe") bindings.describe.add(variable);
      if (name === "it" || name === "test") bindings.tests.add(variable);
      if (name === "expect") bindings.expect.add(variable);
    }
  }

  return bindings;
}

function isImportedCall(call, bindings, sourceCode) {
  return (
    call.type === "CallExpression" &&
    call.callee.type === "Identifier" &&
    bindings.has(variableFor(call.callee, sourceCode))
  );
}

function astShape(node, state, sourceCode, expectBindings) {
  if (Array.isArray(node)) {
    const items = node.map((item) => astShape(item, state, sourceCode, expectBindings));
    return items.includes(unsupported) ? unsupported : items;
  }
  if (node === null || typeof node !== "object") return node;

  if (node.type === "Literal") {
    if (node.regex) return ["Literal", "regex", node.regex.pattern, node.regex.flags];
    if (node.bigint !== undefined) return ["Literal", "bigint", node.bigint];
    const kind = node.value === null ? "null" : typeof node.value;
    state.literals.push(JSON.stringify([kind, node.value]));
    return ["Literal", kind];
  }
  if (node.type === "TemplateElement") {
    return ["TemplateElement", node.value.raw, node.value.cooked, node.tail];
  }

  const fields = nodeFields[node.type];
  if (!fields || (node.type === "UnaryExpression" && node.operator === "delete")) {
    return unsupported;
  }
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    const property = node.callee.property;
    const name = property.type === "Identifier" ? property.name : property.value;
    if (mutatingMethods.has(name)) return unsupported;
  }
  if (node.type === "CallExpression" && isImportedCall(node, expectBindings, sourceCode)) {
    state.expectCalls++;
  }

  const values = fields.map((field) => astShape(node[field], state, sourceCode, expectBindings));
  return values.includes(unsupported) ? unsupported : [node.type, ...values];
}

function candidateFor(call, bindings, sourceCode) {
  if (
    !isImportedCall(call, bindings.tests, sourceCode) ||
    call.arguments[0]?.type !== "Literal" ||
    typeof call.arguments[0].value !== "string"
  ) {
    return null;
  }

  const callback = call.arguments[1];
  if (
    (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") ||
    callback.async ||
    callback.generator
  ) {
    return null;
  }

  const body = callback.body;
  let expression = body;
  if (body.type === "BlockStatement") {
    if (body.body.length !== 1 || body.body[0].type !== "ExpressionStatement") return null;
    expression = body.body[0].expression;
  }
  if (expression.type !== "CallExpression") return null;

  const state = { expectCalls: 0, literals: [] };
  const shape = astShape(body, state, sourceCode, bindings.expect);
  if (shape === unsupported || state.expectCalls !== 1) return null;

  return { body, call, literals: state.literals, signature: JSON.stringify(shape) };
}

function hasDifferentLiterals(candidates) {
  const values = candidates.map(({ literals }) => literals);
  if (values.length < 2 || values[0].length === 0) return false;
  return values[0].some((value, index) => values.slice(1).some((other) => other[index] !== value));
}

function reportCandidates(describeCall, bindings, sourceCode, context) {
  const callback = describeCall.arguments[1];
  if (
    (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") ||
    callback.body.type !== "BlockStatement"
  ) {
    return;
  }

  const groups = new Map();
  for (const statement of callback.body.body) {
    if (
      statement.type !== "ExpressionStatement" ||
      statement.expression.type !== "CallExpression"
    ) {
      continue;
    }
    const candidate = candidateFor(statement.expression, bindings, sourceCode);
    if (!candidate) continue;

    const group = groups.get(candidate.signature) ?? [];
    group.push(candidate);
    groups.set(candidate.signature, group);
  }

  for (const group of groups.values()) {
    if (group.length > 1 && hasDifferentLiterals(group)) {
      context.report({ node: group[1].call, messageId: "preferEach" });
    }
  }
}

const preferTableDrivenTests = {
  meta: {
    type: "suggestion",
    docs: { description: "suggest table-driven tests for structurally identical Vitest cases" },
    schema: [],
    messages: {
      preferEach:
        "Tests in this describe share the same body structure with different literal values; consider it.each() or test.each().",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    let bindings;

    return {
      Program(program) {
        bindings = importedBindings(program, sourceCode);
      },
      CallExpression(node) {
        if (bindings && isImportedCall(node, bindings.describe, sourceCode)) {
          reportCandidates(node, bindings, sourceCode, context);
        }
      },
    };
  },
};

export default {
  meta: { name: "miharu" },
  rules: { "prefer-table-driven-tests": preferTableDrivenTests },
};
