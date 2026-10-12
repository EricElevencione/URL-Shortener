import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../src/prisma.js";

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const apiKey = req.header("X-API-Key");

  if (!apiKey) {
    return res.status(401).json({
      error: "API key is required",
    });
  }

  const keyHash = createHash("sha256").update(apiKey).digest("hex");

  try {
    const storedKey = await prisma.apiKey.findUnique({
      where: { keyHash },
    });

    if (!storedKey || storedKey.revokedAt !== null) {
      return res.status(401).json({
        error: "Invalid or revoked API key",
      });
    }

    try {
      await prisma.apiKey.update({
        where: { id: storedKey.id },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      console.error("Failed to update API key usage:", error);
    }

    res.locals.apiKey = storedKey;

    return next();
  } catch (error) {
    console.error("API key authentication failed:", error);

    return res.status(500).json({
      error: "Authentication service unavailable",
    });
  }
}
