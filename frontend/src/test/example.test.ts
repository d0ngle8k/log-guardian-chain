import { describe, expect, it } from "vitest";
import { formatFileSize, truncateAddress, truncateHash } from "@/lib/hashUtils";

describe("hashUtils", () => {
  it("truncates long hashes", () => {
    const raw = "abcdef0123456789abcdef0123456789abcdef0123456789";
    expect(truncateHash(raw, 6)).toBe("abcdef...456789");
  });

  it("truncates wallet address", () => {
    const address = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    expect(truncateAddress(address, 4)).toBe("7xKX...gAsU");
  });

  it("formats file sizes", () => {
    expect(formatFileSize(999)).toBe("999 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });
});
