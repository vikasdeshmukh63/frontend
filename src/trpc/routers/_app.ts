import {z} from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import { inngest } from "@/inngest/client"
import { messagesRouter } from "@/modules/messages/server/procedures";

export const appRouter = createTRPCRouter({
   messages:messagesRouter
})

export type AppRouter = typeof appRouter;