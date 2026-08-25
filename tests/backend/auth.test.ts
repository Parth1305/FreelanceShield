import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPassword,
  issueAccessToken,
  normalizeEmail,
  normalizeWalletAddress,
  verifyAccessToken,
  verifyPassword,
} from "../../server/auth";
import { ApiError } from "../../server/http";

const secret = "test-only-secret-that-is-more-than-thirty-two-characters";

test("password hashes verify without retaining plaintext", async () => {
  const password = "a secure demo password";
  const passwordHash = await hashPassword(password);
  assert.notEqual(passwordHash, password);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("wrong password", passwordHash), false);
});

test("JWT round-trip preserves the minimum authenticated identity", async () => {
  const user = {
    id: "user-1",
    email: "client@example.com",
    role: "client" as const,
    walletAddress: "0x1111111111111111111111111111111111111111",
  };
  const token = await issueAccessToken(user, secret);
  assert.deepEqual(await verifyAccessToken(token, secret), user);
  await assert.rejects(
    () => verifyAccessToken(`${token}broken`, secret),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
});

test("identity normalization lowercases email and checksums wallets", () => {
  assert.equal(normalizeEmail("  CLIENT@Example.COM "), "client@example.com");
  assert.equal(
    normalizeWalletAddress("0x52908400098527886e0f7030069857d2e4169ee7"),
    "0x52908400098527886E0F7030069857D2E4169EE7",
  );
  assert.throws(() => normalizeWalletAddress("not-a-wallet"), ApiError);
});
