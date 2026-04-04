#!/usr/bin/env node

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function writeEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function parseInvocation(argv) {
  const promptIndex = argv.indexOf('--')
  const prompt =
    promptIndex >= 0 ? argv.slice(promptIndex + 1).join(' ').trim() : ''

  const isResume = argv[0] === 'exec' && argv[1] === 'resume'
  const sessionId =
    isResume && promptIndex > 0 ? argv[promptIndex - 1] : undefined

  let sandboxMode = 'workspace-write'
  const sandboxIndex = argv.indexOf('--sandbox')
  if (sandboxIndex >= 0 && argv[sandboxIndex + 1]) {
    sandboxMode = argv[sandboxIndex + 1]
  }
  if (argv.includes('--dangerously-bypass-approvals-and-sandbox')) {
    sandboxMode = 'danger-full-access'
  }

  return {
    prompt,
    sessionId,
    sandboxMode,
  }
}

async function main() {
  const { prompt, sessionId, sandboxMode } = parseInvocation(process.argv.slice(2))
  const threadId = sessionId || `mock-session-${process.pid}`

  writeEvent({
    type: 'thread.started',
    thread_id: threadId,
  })

  if (prompt.includes('PLUGIN_TIMEOUT_SLEEP_MARKER')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'starting sleep 100',
      },
    })
    await sleep(100_000)
    return
  }

  if (prompt.includes('SLOW_ABORT_MARKER run long response')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'slow-response-started',
      },
    })
    await sleep(100_000)
    return
  }

  if (prompt.includes('TYPING_REPULSE_MARKER')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'repulse-first',
      },
    })
    await sleep(1_800)
    return
  }

  if (prompt.includes('User clicked: Continue action-buttons flow')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'action-buttons-click-continued',
      },
    })
    return
  }

  if (prompt.includes('CODEX_SANDBOX_RETRY_MARKER')) {
    if (sandboxMode === 'read-only') {
      writeEvent({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: 'I hit a sandbox restriction. Permission denied while running in read-only mode.',
        },
      })
      return
    }

    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'sandbox-retry-done',
      },
    })
    return
  }

  if (prompt.includes('Reply with exactly:')) {
    writeEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'ok',
      },
    })
    return
  }

  writeEvent({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      text: 'ok',
    },
  })
}

process.on('SIGTERM', () => {
  process.exit(0)
})

process.on('SIGINT', () => {
  process.exit(0)
})

void main().catch((error) => {
  writeEvent({
    type: 'turn.failed',
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  })
  process.exitCode = 1
})
