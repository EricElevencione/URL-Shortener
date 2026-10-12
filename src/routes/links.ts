import express from "express";
import * as z from "zod";
import { nanoid } from "nanoid";
import { prisma } from "../prisma.js";
import { redis } from "../services/redis.js";
import { Prisma } from "../generated/prisma/client.js";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { apiKeyAuth } from "../../middlware/api-key-auth.js";

const linksRouter = express.Router();

// Zod validation for incoming data
const linksSchema = z.object({
  longUrl: z.url(),
});

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Too many requests from this IP",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<any>,
  }),
});

linksRouter.post("/", limiter, apiKeyAuth, async (req, res) => {
  const result = linksSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).send("Should be valid URL");
  } else if (result === undefined) {
    return res.status(400).send("Should have body");
  } else {
    const longUrl = result.data.longUrl;
    const shortCode = nanoid(10);
    const apiKey = res.locals.apiKey;

    const assignLinks = await prisma.link.create({
      data: {
        longUrl,
        shortCode,
        apiKeyId: apiKey.id,
      },
    });

    // await redis.set(shortCode, longUrl, "EX", 3600);

    res.send(assignLinks);
  }
});

linksRouter.patch("/:shortCode", limiter, apiKeyAuth, async (req, res) => {
  const result = linksSchema.safeParse(req.body);
  const shortCodeSchema = z.string().length(10);
  const linkCode = shortCodeSchema.safeParse(req.params.shortCode);

  if (!result.success) {
    return res.status(400).send("Must define a valid URL");
  }

  if (!linkCode.success) {
    return res.status(400).send("Must define a valid short code");
  }

  const shortCode = linkCode.data;
  const update = result.data;
  const key = `link:${shortCode}`;

  let updating;

  const apiKey = res.locals.apiKey;

  const existingLink = await prisma.link.findUnique({
    where: { shortCode },
  });

  if (!existingLink) {
    return res.status(404).send("shortCode doesn't exist");
  }

  if (existingLink.apiKeyId !== apiKey.id) {
    return res.status(403).send("You don't own this link");
  }

  try {
    updating = await prisma.link.update({
      where: { shortCode },
      data: { longUrl: update.longUrl },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).send("shortCode doesn't exist");
    }

    console.error("Failed to update link:", error);
    return res.status(500).send("Failed to update link");
  }

  try {
    await redis.del(key);
  } catch (error) {
    console.error("Redis cache invalidation failed:", error);
  }

  return res.status(200).json(updating);
});

export default linksRouter;
