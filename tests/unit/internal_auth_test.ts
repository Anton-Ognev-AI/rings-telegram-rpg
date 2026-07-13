import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import { isAuthorizedInternalRequest } from "../../supabase/functions/_shared/infrastructure/internal-auth.ts";

const secret = "0123456789abcdef0123456789abcdef";

function request(header?: string): Request {
  return new Request("http://localhost/internal", {
    method: "POST",
    headers: header === undefined ? undefined : { "X-TgGame-Internal-Secret": header },
  });
}

Deno.test("internal request authorization accepts only the exact configured secret", () => {
  assertEquals(isAuthorizedInternalRequest(request(secret), secret), true);
  assertEquals(isAuthorizedInternalRequest(request(), secret), false);
  assertEquals(isAuthorizedInternalRequest(request(`${secret}x`), secret), false);
  assertEquals(isAuthorizedInternalRequest(request("x".repeat(257)), secret), false);
});

Deno.test("internal request authorization rejects unsafe secret configuration", () => {
  assertThrows(
    () => isAuthorizedInternalRequest(request("short"), "short"),
    Error,
    "invalid_internal_secret_configuration",
  );
  assertThrows(
    () => isAuthorizedInternalRequest(request("x".repeat(257)), "x".repeat(257)),
    Error,
    "invalid_internal_secret_configuration",
  );
});
