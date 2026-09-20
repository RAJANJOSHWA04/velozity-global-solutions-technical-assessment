import cron from "node-cron";
import { TaskStatus } from "@prisma/client";
import { prisma } from "./prisma.js";

/**
 * Keep the persisted overdue flag synchronized
 * with the database clock.
 *
 * This runs independently of page loads.
 */
export function startOverdueTaskScheduler() {
  const run = async () => {
    const now = new Date();

    await prisma.$transaction([
      /**
       * Mark incomplete tasks as overdue
       * once their due date has passed.
       */
      prisma.task.updateMany({
        where: {
          dueDate: {
            lt: now,
          },
          status: {
            not: TaskStatus.DONE,
          },
          isOverdue: false,
        },
        data: {
          isOverdue: true,
        },
      }),

      /**
       * Remove overdue flag when a task is no
       * longer overdue, for example:
       *
       * - due date was extended
       * - task was completed
       */
      prisma.task.updateMany({
        where: {
          OR: [
            {
              dueDate: {
                gte: now,
              },
            },
            {
              status: TaskStatus.DONE,
            },
          ],
          isOverdue: true,
        },
        data: {
          isOverdue: false,
        },
      }),
    ]);
  };

  /**
   * Run every minute.
   */
  cron.schedule("*/10 * * * *", async () => {
    try {
      await run();
    } catch (error) {
      console.error(
        "Overdue task scheduler failed",
        error
      );
    }
  });

  /**
   * Run once when the server starts.
   * This prevents waiting for the first cron tick.
   */
  void run().catch((error) => {
    console.error(
      "Initial overdue task check failed",
      error
    );
  });
}