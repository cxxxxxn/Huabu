// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Command } from 'commander';

export interface InputOptions {
  json?: string;
  jsonFile?: string;
  text?: string;
  textFile?: string;
  noStart?: boolean;
}

export interface DownloadOptions {
  output?: string;
  dumpHeader?: string;
  ifNoneMatch?: string;
}

export interface RfsActions {
  rootHelp: () => Promise<void>;
  getSkill: (id: string | undefined, usage: string) => Promise<void>;
  query: (options: InputOptions) => Promise<void>;
  execute: (options: InputOptions) => Promise<void>;
  download: (path: string, options: DownloadOptions) => Promise<void>;
  upload: (name: string, file: string) => Promise<void>;
  profiles: () => Promise<void>;
  create: (options: InputOptions) => Promise<void>;
  prompt: (thread: string, options: InputOptions) => Promise<void>;
  services: () => Promise<void>;
  serviceSkill: (id: string) => Promise<void>;
  serviceManifest: (id: string) => Promise<void>;
  serviceDownload: (id: string, folder: string) => Promise<void>;
}

export function segment(value: string | undefined): string {
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value))
    throw new Error(
      'Expected one nonempty logical path segment, not a URL or traversal',
    );
  return encodeURIComponent(value);
}

export function createRfsProgram(
  actions: RfsActions,
  write: (text: string) => void,
) {
  const guides = new Map<Command, string>();
  let helpCommand: Command | undefined;
  const program = new Command()
    .name('huabu-rfs')
    .description('Huabu RFS (optional Node client)')
    .exitOverride()
    .configureOutput({
      writeOut: write,
      // runRfs reports Commander errors without exiting the host process.
      writeErr: () => {},
    })
    .addHelpText(
      'after',
      '\nRequired environment: HUABU_RFS_URL, AGENTLET_TOKEN.\n' +
        'Node is selected by the Agent, not provided by Huabu.\n' +
        'Operation response bodies and SSE are raw; exit 0 is HTTP success/normal EOF, not business success.\n' +
        'No redirects, retries, reconnects or remote cancellation.\n' +
        'Start with get-skill; use COMMAND --help for its current workflow.\n',
    );

  function guide(command: Command, id: string) {
    guides.set(command, id);
    command.on('beforeHelp', () => {
      helpCommand = command;
    });
    return command;
  }
  function inputs(command: Command, text: boolean) {
    command
      .option('--json <string>', 'Forward JSON bytes unchanged')
      .option(
        '--json-file <path>',
        'Read JSON bytes from a file, or - for stdin',
      );
    if (text)
      command
        .option('--text <string>', 'Forward plain text unchanged')
        .option(
          '--text-file <path>',
          'Read plain text from a file, or - for stdin',
        );
    return command;
  }
  guide(program, 'rfs').action(actions.rootHelp);
  guide(
    program
      .command('get-skill [skillId]')
      .description('Load root or focused Skill'),
    'rfs-get-skill',
  ).action((id: string | undefined) =>
    actions.getSkill(id, program.helpInformation()),
  );

  for (const [name, action] of [
    ['query', actions.query],
    ['execute', actions.execute],
  ] as const) {
    const command = guide(
      inputs(
        program.command(name).description(`Send raw ${name} JSON`),
        false,
      ).helpOption(
        '-h, --help',
        'Show workflow; --help TYPE loads one operation contract',
      ),
      `rfs-${name}`,
    );
    command.action(() => action(command.opts<InputOptions>()));
  }
  const download = guide(
    program
      .command('download <logicalPath>')
      .description('Download raw bytes and optional metadata')
      .option(
        '--output <path>',
        'Replace a local file only after a complete successful transfer',
      )
      .option(
        '--dump-header <path>',
        'Write semantic HTTP status and metadata headers',
      )
      .option('--if-none-match <etag>', 'Preserve cached content on 304'),
    'rfs-download',
  );
  download.action((path: string) =>
    actions.download(path, download.opts<DownloadOptions>()),
  );
  const upload = guide(
    program
      .command('upload <name>')
      .description('Stage raw file bytes')
      .requiredOption('--file <path>', 'File path, or - for stdin'),
    'rfs-upload',
  );
  upload.action((name: string) =>
    actions.upload(name, upload.opts<{ file: string }>().file),
  );

  const agent = guide(
    program.command('agent').description('Create or continue an Agent'),
    'rfs-agent',
  );
  guide(
    agent.command('profiles').description('List available Profiles'),
    'rfs-agent',
  ).action(actions.profiles);
  const create = guide(
    inputs(
      agent
        .command('create')
        .description('Create an Agent and optionally start its first turn'),
      true,
    ).option('--no-start', 'Create idle; requires a JSON input source'),
    'rfs-agent',
  );
  create.action(() =>
    actions.create({
      ...create.opts<InputOptions>(),
      noStart: create.opts<{ start: boolean }>().start === false,
    }),
  );
  const prompt = guide(
    inputs(
      agent
        .command('prompt <threadId>')
        .description('Continue an existing conversation'),
      true,
    ),
    'rfs-agent',
  );
  prompt.action((thread: string) =>
    actions.prompt(thread, prompt.opts<InputOptions>()),
  );

  const service = guide(
    program
      .command('service')
      .description('Discover and download Service Packages'),
    'rfs-service',
  );
  guide(
    service
      .command('list')
      .description('List Services and masked availability'),
    'rfs-service',
  ).action(actions.services);
  guide(
    service.command('skill <id>').description('Read a Package Skill'),
    'rfs-service',
  ).action(actions.serviceSkill);
  guide(
    service
      .command('manifest <id>')
      .description('Read a Package Manifest without credentials'),
    'rfs-service',
  ).action(actions.serviceManifest);
  const serviceDownload = guide(
    service
      .command('download <id>')
      .description('Download and safely extract a Package without executing it')
      .requiredOption(
        '--out-folder <folder>',
        'Parent directory; creates FOLDER/ID and refuses existing targets',
      ),
    'rfs-service',
  );
  serviceDownload.action((id: string) =>
    actions.serviceDownload(
      id,
      serviceDownload.opts<{ outFolder: string }>().outFolder,
    ),
  );

  return {
    program,
    liveHelp() {
      if (!helpCommand) throw new Error('Help target was not selected');
      const name = helpCommand.name();
      const guideId = guides.get(helpCommand);
      if (!guideId) throw new Error('Missing command help guide');
      let capability: string | undefined;
      if (name === 'query' || name === 'execute') {
        const operands = helpCommand.args.filter(
          (arg) => arg !== '--help' && arg !== '-h',
        );
        if (operands.length > 1)
          throw new Error('Help accepts at most one operation type');
        capability = operands[0]
          ? `/capabilities/${name === 'query' ? 'queries' : 'commands'}/${segment(operands[0])}`
          : '/capabilities';
      }
      return { guide: `/skill/${guideId}`, capability };
    },
  };
}
