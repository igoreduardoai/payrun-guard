import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The UI imports the PayRun Guard engine from ../packages (one repo, one source of truth).
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  images: { unoptimized: true },
}

export default nextConfig
