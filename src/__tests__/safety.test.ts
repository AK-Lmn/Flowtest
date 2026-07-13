import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPrivateIp, validateUrl } from "@/lib/safety";
import dns from "dns";

vi.mock("dns", () => ({
  default: {
    promises: {
      lookup: vi.fn(),
    },
  },
}));

describe("safety URL and IP validations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isPrivateIp", () => {
    it("should classify private IPv4 addresses correctly", () => {
      expect(isPrivateIp("10.0.0.1")).toBe(true);
      expect(isPrivateIp("172.16.5.9")).toBe(true);
      expect(isPrivateIp("172.31.255.255")).toBe(true);
      expect(isPrivateIp("192.168.1.100")).toBe(true);
    });

    it("should classify loopback and local IPv4 addresses correctly", () => {
      expect(isPrivateIp("127.0.0.1")).toBe(true);
      expect(isPrivateIp("127.255.0.1")).toBe(true);
      expect(isPrivateIp("169.254.10.10")).toBe(true);
      expect(isPrivateIp("0.0.0.0")).toBe(true);
    });

    it("should classify multicast and reserved IPv4 addresses correctly", () => {
      expect(isPrivateIp("224.0.0.1")).toBe(true);
      expect(isPrivateIp("245.0.0.1")).toBe(true);
    });

    it("should classify public IPv4 addresses correctly", () => {
      expect(isPrivateIp("8.8.8.8")).toBe(false);
      expect(isPrivateIp("1.1.1.1")).toBe(false);
      expect(isPrivateIp("104.244.42.1")).toBe(false);
    });

    it("should classify private and loopback IPv6 addresses correctly", () => {
      expect(isPrivateIp("::1")).toBe(true);
      expect(isPrivateIp("::")).toBe(true);
      expect(isPrivateIp("fc00::1")).toBe(true);
      expect(isPrivateIp("fdff:ffff::")).toBe(true);
      expect(isPrivateIp("fe80::1")).toBe(true);
      expect(isPrivateIp("ff02::1")).toBe(true);
    });

    it("should classify public IPv6 addresses correctly", () => {
      expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
    });
  });

  describe("validateUrl", () => {
    it("should reject non-http(s) protocols", async () => {
      const res = await validateUrl("ftp://example.com");
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("Protocol must be http: or https:");

      const res2 = await validateUrl("javascript:alert(1)");
      expect(res2.isValid).toBe(false);
    });

    it("should reject embedded credentials", async () => {
      const res = await validateUrl("https://user:password@example.com");
      expect(res.isValid).toBe(false);
      expect(res.error?.toLowerCase()).toContain("embedded username or password credentials");
    });

    it("should reject non-standard ports", async () => {
      const res = await validateUrl("https://example.com:8443");
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("Port is blocked for safety");
    });

    it("should reject localhost and local domain names", async () => {
      const res = await validateUrl("https://localhost");
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("Local or private domain names are blocked");

      const res2 = await validateUrl("https://my-service.local");
      expect(res2.isValid).toBe(false);
    });

    it("should resolve hostnames and block private IP destinations", async () => {
      // Mock dns.promises.lookup to return a private IP
      vi.spyOn(dns.promises, "lookup").mockResolvedValue({ address: "192.168.1.5", family: 4 });

      const res = await validateUrl("https://malicious-site.com");
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("resolves to a private or loopback IP address");
    });

    it("should allow valid public websites", async () => {
      vi.spyOn(dns.promises, "lookup").mockResolvedValue({ address: "104.244.42.1", family: 4 });

      const res = await validateUrl("https://twitter.com");
      expect(res.isValid).toBe(true);
      expect(res.resolvedIp).toBe("104.244.42.1");
    });
  });
});
