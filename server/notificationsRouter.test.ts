import { describe, expect, it } from "vitest";
import { parseNotificationMetadata } from "./notificationsRouter";

describe("notification metadata", () => {
  it("parses an object payload and rejects malformed or non-object values", () => {
    expect(parseNotificationMetadata('{"tournamentId":7}')).toEqual({ tournamentId: 7 });
    expect(parseNotificationMetadata('["not-an-object"]')).toBeNull();
    expect(parseNotificationMetadata('{malformed')).toBeNull();
    expect(parseNotificationMetadata(null)).toBeNull();
  });
});
