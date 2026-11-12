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
    "https://github.com/owner/repo/pulls-other/amruth-sn/12"
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

test("arbitrary PR suffixes authorize only the current repository, not suffix or original URL repositories", () => {
  for (const suffix of [
    "anything",
    "assigned/person",
    "future/v2/not_a_login",
    "other/repo/pulls",
    "_layout"
  ]) {
    const repository = repositoryForAuthorizedSender(
      {
        id: extensionId,
        frameId: 0,
        url: "https://github.com/old-owner/old-repo/pulls",
        tab: { url: `https://github.com/Current-Owner/Current-Repo/pulls/${suffix}` }
      },
      extensionId
    );
    assert.equal(repository, "current-owner/current-repo");
    assert.equal(
      isRepositoryScopedSave([{ scope: "current-owner/current-repo" }], repository),
      true
    );
    for (const scope of ["old-owner/old-repo", "other/repo", "global"])
      assert.equal(isRepositoryScopedSave([{ scope }], repository), false, scope);
  }
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

test("SPA saves use the current tab repository while retaining sender authorization", () => {
  const sender = {
    id: extensionId,
    url: "https://github.com/owner/original/issues",
    frameId: 0,
    tab: { url: "https://github.com/owner/current/pulls/amruth-sn" }
  };
  assert.equal(repositoryForAuthorizedSender(sender, extensionId), "owner/current");
  assert.equal(
    repositoryForAuthorizedSender({ ...sender, id: "other-extension" }, extensionId),
    null
  );
  assert.equal(repositoryForAuthorizedSender({ ...sender, frameId: 1 }, extensionId), null);
  assert.equal(
    repositoryForAuthorizedSender(
      { ...sender, url: "https://evil.example/owner/repo/pulls" },
      extensionId
    ),
    null
  );
  for (const url of [
    "https://github.com/owner/current",
    "https://github.com/owner/current/issues",
    "https://evil.example/owner/current/pulls",
    "http://github.com/owner/current/pulls",
    "https://github.com:444/owner/current/pulls",
    "https://attacker@github.com/owner/current/pulls"
  ])
    assert.equal(
      repositoryForAuthorizedSender({ ...sender, tab: { url } }, extensionId),
      null,
      url
    );
  assert.equal(isRepositoryScopedSave([{ scope: "owner/original" }], "owner/current"), false);
});
