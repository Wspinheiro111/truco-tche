import { describe, expect, it } from "vitest";
import { pushSubscriptionSchema } from "./pushRouter";

describe("Web Push subscription contract", () => {
  const validSubscription = {
    endpoint: "https://push.example.test/subscription/abc",
    p256dh: "BK8qL4qA0c9gPjM-random-public-key-value-1234567890",
    auth: "web-push-authentication-secret-12345",
  };

  it("accepts a complete browser subscription", () => {
    expect(pushSubscriptionSchema.safeParse(validSubscription).success).toBe(true);
  });

  it("rejects a malformed endpoint or incomplete key material", () => {
    expect(pushSubscriptionSchema.safeParse({ ...validSubscription, endpoint: "not-a-url" }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...validSubscription, auth: "short" }).success).toBe(false);
  });
});
