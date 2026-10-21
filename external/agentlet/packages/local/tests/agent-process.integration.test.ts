import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { AgentProcess } from '../src/agent-process.js'

async function waitForExit(agent: AgentProcess): Promise<void> {
  const deadline = Date.now() + 5000
  while (agent.running && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  expect(agent.running).toBe(false)
}

describe.skipIf(process.platform === 'win32')('owned process tree cleanup', () => {
  it('retains ownership after the shell exits and kills stubborn child and grandchild processes', async () => {
    const grandchild = `
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
      process.send('ready');
    `
    const script = `
      const { spawn } = require('node:child_process');
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      child.on('message', () => console.log(JSON.stringify({
        pid: process.pid, childPid: child.pid,
      })));
    `
    const agent = new AgentProcess({
      command: `${JSON.stringify(process.execPath)} -e '${script.replace(/'/g, "'\\''")}'; wait`,
    })
    const started = once(agent, 'message', { signal: AbortSignal.timeout(5000) })
    agent.start()
    try {
      const [message] = await started
      const exited = once(agent, 'exit', { signal: AbortSignal.timeout(5000) })
      agent.closeStdin()
      await agent.terminate()
      await exited
      expect(agent.running).toBe(true)
      process.kill(message.pid, 0)
      process.kill(message.childPid, 0)
      await agent.kill()
      await waitForExit(agent)
      expect(() => process.kill(message.pid, 0)).toThrow()
      expect(() => process.kill(message.childPid, 0)).toThrow()
    } finally {
      await agent.kill()
      await waitForExit(agent)
    }
  }, 15_000)
})
