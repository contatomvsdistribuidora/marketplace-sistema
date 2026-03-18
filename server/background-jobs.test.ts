import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("./db", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

// Mock mercadolivre
vi.mock("./mercadolivre", () => ({
  getValidToken: vi.fn().mockResolvedValue("mock-token"),
  publishProduct: vi.fn().mockResolvedValue({ success: true, mlItemId: "MLB123" }),
  saveListing: vi.fn().mockResolvedValue(undefined),
}));

// Mock notification
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Mock ai-mapper
vi.mock("./ai-mapper", () => ({
  mapCategory: vi.fn().mockResolvedValue({ id: "MLB123", name: "Test Category" }),
  mapAttributes: vi.fn().mockResolvedValue([]),
}));

// Mock baselinker
vi.mock("./baselinker", () => ({
  getInventoryProductsData: vi.fn().mockResolvedValue({ products: {} }),
}));

describe("Background Jobs", () => {
  describe("createBackgroundJob", () => {
    it("should export createBackgroundJob, getBackgroundJobs, getBackgroundJob, cancelBackgroundJob functions", async () => {
      const bgWorker = await import("./background-worker");
      expect(typeof bgWorker.createBackgroundJob).toBe("function");
      expect(typeof bgWorker.getBackgroundJobs).toBe("function");
      expect(typeof bgWorker.getBackgroundJob).toBe("function");
      expect(typeof bgWorker.cancelBackgroundJob).toBe("function");
      expect(typeof bgWorker.startBackgroundWorker).toBe("function");
    });
  });

  describe("Background Job CRUD operations", () => {
    it("should create a background job and return an id", async () => {
      const bgWorker = await import("./background-worker");
      
      const jobId = await bgWorker.createBackgroundJob({
        userId: 1,
        type: "export_ml",
        marketplaceId: 1,
        accountId: 1,
        accountName: "Test Account",
        totalItems: 10,
        concurrency: 5,
        productIds: ["1", "2", "3"],
      });

      expect(jobId).toBeGreaterThan(0);
    });

    it("should retrieve a background job by id", async () => {
      const bgWorker = await import("./background-worker");
      
      const jobId = await bgWorker.createBackgroundJob({
        userId: 1,
        type: "generate_titles",
        totalItems: 5,
        concurrency: 3,
      });

      const job = await bgWorker.getBackgroundJob(jobId);
      expect(job).not.toBeNull();
      expect(job!.id).toBe(jobId);
      expect(job!.type).toBe("generate_titles");
      expect(job!.status).toBe("queued");
      expect(job!.totalItems).toBe(5);
    });

    it("should list background jobs for a user", async () => {
      const bgWorker = await import("./background-worker");
      
      // Create a couple of jobs
      await bgWorker.createBackgroundJob({
        userId: 999,
        type: "export_ml",
        totalItems: 10,
      });
      await bgWorker.createBackgroundJob({
        userId: 999,
        type: "generate_descriptions",
        totalItems: 20,
      });

      const jobs = await bgWorker.getBackgroundJobs(999, 50);
      expect(jobs.length).toBeGreaterThanOrEqual(2);
      // All jobs should belong to user 999
      for (const job of jobs) {
        expect(job.userId).toBe(999);
      }
    });

    it("should cancel a background job", async () => {
      const bgWorker = await import("./background-worker");
      
      const jobId = await bgWorker.createBackgroundJob({
        userId: 1,
        type: "export_ml",
        totalItems: 10,
      });

      const success = await bgWorker.cancelBackgroundJob(jobId, 1);
      expect(success).toBe(true);

      const job = await bgWorker.getBackgroundJob(jobId);
      expect(job!.status).toBe("cancelled");
    });

    it("should not cancel a job belonging to another user", async () => {
      const bgWorker = await import("./background-worker");
      
      const jobId = await bgWorker.createBackgroundJob({
        userId: 1,
        type: "export_ml",
        totalItems: 10,
      });

      const success = await bgWorker.cancelBackgroundJob(jobId, 2);
      expect(success).toBe(false);
    });

    it("should create a scheduled job with scheduledFor date", async () => {
      const bgWorker = await import("./background-worker");
      
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      const jobId = await bgWorker.createBackgroundJob({
        userId: 1,
        type: "export_ml",
        totalItems: 10,
        scheduledFor: futureDate,
      });

      const job = await bgWorker.getBackgroundJob(jobId);
      expect(job!.status).toBe("scheduled");
      expect(job!.scheduledFor).not.toBeNull();
    });
  });
});
