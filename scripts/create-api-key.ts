import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../src/prisma.js";

async function main() {
  const apiKey = randomBytes(32).toString("hex");

  const keyHash = createHash("sha256").update(apiKey).digest("hex");

  await prisma.apiKey.create({
    data: {
      keyHash,
    },
  });

  console.log("Your API key (save it now):");
  console.log(apiKey);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
