import express from "express";
import linksRouter from "./routes/links.js";
import { redis } from "./services/redis.js";
import * as z from "zod";
import { prisma } from "./prisma.js";
import { Prisma } from "./generated/prisma/client.js";

const app = express();

// Middleware to parse incoming requests with JSON payloads
app.use(express.json());

app.use("/links", linksRouter);

app.get("/:shortCode", async (req, res) => {
  const shortCodeSchema = z.string().length(10);
  const linkCode = shortCodeSchema.safeParse(req.params.shortCode);

  if (!linkCode.success) {
    return res
      .status(400)
      .send(linkCode.error.issues.map((issue) => issue.message).join(", "));
  }

  const shortCode = linkCode.data;
  const key = `link:${shortCode}`;

  let cachedUrl: string | null = null;

  try {
    cachedUrl = await redis.get(key);
  } catch (error) {
    console.error("Redis lookup failed:", error);
  }

  let longUrl: string;

  if (cachedUrl !== null) {
    // Redis HIT
    longUrl = cachedUrl;
  } else {
    // Redis MISS → check PostgreSQL
    const findLinks = await prisma.link.findUnique({
      where: {
        shortCode,
      },
    });

    if (findLinks === null) {
      return res.status(404).send("Link not found");
    }

    longUrl = findLinks.longUrl;

    // Cache it for future requests
    try {
      await redis.set(key, longUrl, "EX", 3600);
    } catch (error) {
      console.error("Redis lookup failed:", error);
    }
  }

  // Count the redirect regardless of Redis HIT or MISS
  try {
    await prisma.link.update({
      where: { shortCode },
      data: { clicks: { increment: 1 } },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      try {
        await redis.del(key);
      } catch (redisError) {
        console.error("Failed to delete stale cache:", redisError);
      }

      return res.status(404).send("Link not found");
    }

    console.error("Failed to increment click count:", error);
  }

  return res.redirect(302, longUrl);
});

export default app;
