'use strict';

const assert = require('node:assert/strict');
const ts = require('typescript');

// Research fixture only: fail when production wiring no longer matches the
// reviewed shape, rather than silently testing an unrelated/nested callback.
module.exports = function extractLifecycleCallbacks(text) {
  const source = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0, 'Invalid lifecycle source');
  const factories = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'createWindow');
  assert.equal(factories.length, 1, 'Expected exactly one createWindow');
  const factory = factories[0];
  assert.ok(factory.body, 'Expected createWindow body');
  const receivers = new Map([
    ['did-start-navigation', 'win.webContents'],
    ['render-process-gone', 'wc'],
    ['destroyed', 'wc']
  ]);
  const callbacks = new Map();
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments[0]
      && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
      && receivers.has(node.arguments[0].text)) {
      const event = node.arguments[0].text;
      assert.ok(!callbacks.has(event), `Duplicate lifecycle event: ${event}`);
      assert.ok(ts.isExpressionStatement(node.parent) && node.parent.parent === factory.body,
        `Lifecycle registration must be direct: ${event}`);
      const method = node.expression;
      assert.ok(ts.isPropertyAccessExpression(method) && method.name.text === 'on',
        `Expected on registration: ${event}`);
      const receiver = method.expression;
      const validReceiver = receivers.get(event) === 'wc'
        ? ts.isIdentifier(receiver) && receiver.text === 'wc'
        : ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'webContents'
          && ts.isIdentifier(receiver.expression) && receiver.expression.text === 'win';
      assert.ok(validReceiver, `Wrong lifecycle receiver: ${event}`);
      assert.ok(node.arguments.length === 2 && ts.isArrowFunction(node.arguments[1]),
        `Expected inline lifecycle callback: ${event}`);
      callbacks.set(event, node.arguments[1].getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(factory);
  assert.equal(callbacks.size, receivers.size, 'Missing lifecycle registration');
  return callbacks;
};
