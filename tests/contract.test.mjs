// Runtime checks that the agent tool bindings route to the v3 browser contract (BR-1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractBytes = readFileSync(join(root, "contracts/browser-contract-v3.json"));
const contract = JSON.parse(contractBytes.toString("utf8"));
const plugin = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
const extension = plugin.extensions["com.xsec.desktop"];
const bindings = Object.values(extension.contributes.agentTools);
const toolNames = Object.keys(contract.tools);
const declaredPermissions = new Set(Object.keys(extension.permissions));
const ROLES = new Set(["parent", "sub"]);

test("the manifest pins the exact contract file it routes to", () => {
  assert.equal(extension.browserContract.id, contract.contractId);
  assert.equal(extension.browserContract.version, contract.version);
  assert.equal(extension.browserContract.toolCount, toolNames.length);
  assert.equal(createHash("sha256").update(contractBytes).digest("hex"), extension.browserContract.sha256);
});

test("each contract tool is routed by exactly one agent tool binding", () => {
  const routed = bindings.map((binding) => binding.mcpTool);
  assert.equal(new Set(routed).size, routed.length, "a tool has more than one binding");
  assert.deepEqual([...routed].sort(), [...toolNames].sort());
});

test("bindings use the browser server, the browser workspace tool and declared permissions", () => {
  for (const binding of bindings) {
    assert.equal(binding.mcpServer, "browser", binding.mcpTool);
    assert.equal(binding.workspaceToolId, "browser", binding.mcpTool);
    assert.ok(declaredPermissions.has(binding.permission), `${binding.mcpTool} needs undeclared ${binding.permission}`);
    assert.ok(binding.roles.length > 0 && binding.roles.every((role) => ROLES.has(role)), `${binding.mcpTool} has invalid roles`);
  }
});

test("frontend methods only use declared capabilities", () => {
  for (const [name, method] of Object.entries(extension.frontendApi.methods)) {
    assert.ok(declaredPermissions.has(method.capability), `${name} needs undeclared ${method.capability}`);
  }
});

test("every contract schema is a closed object whose required fields are declared", () => {
  for (const name of toolNames) {
    const schema = contract.tools[name];
    assert.equal(schema.type, "object", name);
    assert.equal(schema.additionalProperties, false, name);
    for (const field of schema.required ?? []) {
      assert.ok(Object.hasOwn(schema.properties, field), `${name} requires undeclared ${field}`);
    }
  }
});
