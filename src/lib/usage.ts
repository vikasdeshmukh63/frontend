import { auth } from "@clerk/nextjs/server";
import { RateLimiterPrisma } from "rate-limiter-flexible";
import { prisma } from "./db";

const FREE_POINTS = 5;
const PRO_POINTS = 100;
const DURATION = 30*24*60*60; // 30 days in seconds
const GENERATION_COST = 2

export async function getUsageTracker(){

    const {has} = await auth()
    const hasProAccess = has({plan:"pro"})

    // Prisma delegates use camelCase (model `Usage` → `prisma.usage`), not PascalCase.
    const usageTracker = new RateLimiterPrisma({
        storeClient: prisma,
        tableName: 'usage',
        points:hasProAccess ? PRO_POINTS : FREE_POINTS,
        duration:DURATION, // 30 days
    })
    return usageTracker;
}

export async function consumeCredits(){
    const {userId} = await auth();

    if(!userId) throw new Error("User not authenticated");

    const usageTracker = await getUsageTracker()

    const result = await usageTracker.consume(userId,GENERATION_COST)

    return result;
}

export async function getUsageStatus(){
    const {userId} = await auth();

    if(!userId) throw new Error("User not authenticated");

    const usageTracker = await getUsageTracker()

    const result = await usageTracker.get(userId)
    return result;
}