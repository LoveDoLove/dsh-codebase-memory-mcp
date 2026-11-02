/**
 * Codebase Memory — Legacy Bridge Compatibility Layer.
 * Re-exports core discovery, client, and tool registration interfaces.
 */

import { cbmProjectName, projectNameFromPath } from './discovery.mjs'
import {
  findCodebaseMemoryExe,
  findExe,
  CodebaseMemoryClient,
  createClient,
  getOrCreateCodeClient,
  getOrCreateClient,
  autoStartCodebaseMemory,
} from './client.mjs'
import { registerCbmTools as registerModernTools, createCbmToolDefinitions } from './tools.mjs'

export {
  cbmProjectName,
  projectNameFromPath,
  findCodebaseMemoryExe,
  findExe,
  CodebaseMemoryClient,
  createClient,
  getOrCreateCodeClient,
  getOrCreateClient,
  autoStartCodebaseMemory,
  createCbmToolDefinitions,
}

export const EXE = findCodebaseMemoryExe()

/**
 * Register cbm_* tools onto ctx.tools for bridge consumers.
 * Supports legacy string return values for existing test expectations.
 */
export function registerCbmTools(ctx, client) {
  return registerModernTools(ctx, { client, legacyText: true })
}

/**
 * Legacy application hook for Cordis context.
 */
export function cbmApply(ctx) {
  const client = getOrCreateClient()
  if (!client) return []

  ctx.effect?.(() => () => {
    client.dispose?.()
  }, 'codebase-memory: client')

  const isTest =
    process.env.NODE_ENV === 'test' ||
    process.execArgv.includes('--test') ||
    process.argv.includes('--test') ||
    process.argv.some((arg) => typeof arg === 'string' && (arg.endsWith('.test.mjs') || arg.endsWith('.test.js')))

  if (!isTest && client.isAvailable && !client.isRunning?.()) {
    autoStartCodebaseMemory(client, ctx?.logger?.('codebase-memory') || console)
  }

  return registerCbmTools(ctx, client)
}
