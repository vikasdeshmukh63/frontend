import { inngest } from "./client";

export const helloWorld = inngest.createFunction(
  { id: "hello-world" },
  { event: "test/hello.world" },
  async ({ event, step }) => {
    // imagine this downalod step
    await step.sleep("wait-a-moment", "30s");

    // imagine this a transcript step
    await step.sleep("wait-a-moment", "10s");

    // imagine this is summary step
    await step.sleep("wait-a-moment", "5s");

    return { message: `Hello ${event.data.email}!` };
  },
);