import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { isRepositoryScopedSave, repositoryForAuthorizedSender } from "../src/background";

const extensionId = "extension-id";

test("save authorization accepts only this extension's HTTPS repository pulls page", () => {
  assert.equal(
    repositoryForAuthorizedSender(
      {
        id: extensionId,
        url: "https://github.com/OctoCat/Hello-World/pulls?state=open"
      },
      extensionId
    ),
    "octocat/hello-world"
  );
  assert.equal(
    repositoryForAuthorizedSender(
      { id: "other-extension", url: "https://github.com/owner/repo/pulls" },
      extensionId
    ),
    null
  );
  for (const url of [
    "http://github.com/owner/repo/pulls",
    "https://github.com:444/owner/repo/pulls",
    "https://attacker@github.com/owner/repo/pulls",
    "https://evil.example/owner/repo/pulls",
    "https://github.com/pulls",
    "https://github.com/owner/repo/pull/12",
    "https://github.com/owner/repo/pulls/12"
  ]) {
    assert.equal(repositoryForAuthorizedSender({ id: extensionId, url }, extensionId), null, url);
  }
  assert.equal(
    repositoryForAuthorizedSender(
      { id: extensionId, url: "https://github.com/owner/repo/pulls" },
      undefined
    ),
    null
  );
});

test("save payload must target exactly the current repository", () => {
  assert.equal(isRepositoryScopedSave([{ scope: "owner/repo" }], "owner/repo"), true);
  assert.equal(isRepositoryScopedSave([{ scope: "global" }], "owner/repo"), false);
  assert.equal(isRepositoryScopedSave([{ scope: "other/repo" }], "owner/repo"), false);
  assert.equal(
    isRepositoryScopedSave([{ scope: "owner/repo" }, { scope: "global" }], "owner/repo"),
    false
  );
  assert.equal(isRepositoryScopedSave([], "owner/repo"), false);
  assert.equal(isRepositoryScopedSave(null, "owner/repo"), false);
});
