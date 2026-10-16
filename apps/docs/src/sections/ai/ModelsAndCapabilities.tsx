// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {
  Callout,
  DocLink,
  H2,
  P,
  PageLayout,
  Table,
  type TocEntry,
} from '../../components';

const toc: TocEntry[] = [
  { id: 'bring-your-own-agent', label: 'Bring your own agent' },
  { id: 'utility-tasks', label: 'Utility tasks' },
  { id: 'optional-built-in-pi', label: 'Optional Built-In Pi' },
  { id: 'image-understanding', label: 'Image understanding' },
  { id: 'image-generation', label: 'Image generation' },
  { id: 'web-and-video', label: 'Web search and video transcripts' },
];

export default function ModelsAndCapabilities() {
  return (
    <PageLayout
      title="Models & Capabilities"
      description="Use your existing agents for conversations and background tasks, and configure optional Huabu services separately."
      toc={toc}
    >
      <H2>Bring your own agent</H2>
      <P>
        Connect an agent you already use in <strong>Settings &gt; Agent</strong>
        . Huabu provides the visual workspace, Space context, conversation
        interface, and change review; the agent&apos;s harness provides its
        model access, authentication, tools, and permissions. No built-in model
        setup is required to start working with a connected agent. See{' '}
        <DocLink href="/docs/ai/external-agents">External Agents</DocLink> for
        supported ACP connections.
      </P>
      <Table
        headers={['Setting', 'Used for', 'Required']}
        rows={[
          [
            <strong>Agent Profile</strong>,
            'Conversations and work on the Space using your existing agent.',
            'Connect an agent, or explicitly configure Built-In Pi instead.',
          ],
          [
            <strong>Utility tasks</strong>,
            'Huabu-owned background work such as titles, summaries, keywords, and image labels.',
            'A configured and available Utility Agent.',
          ],
          [
            <strong>Services</strong>,
            'Optional Huabu integrations for OCR, image generation, web search, and video transcripts.',
            'Only for the integration you want to use.',
          ],
        ]}
      />

      <H2>Utility tasks</H2>
      <P>
        Under <strong>Settings &gt; Agent &gt; Utility tasks</strong>, select an
        external Profile for automatic titles, summaries, keywords, image
        labels, and other supported background tasks. On first setup, Huabu
        selects an available external Profile automatically when no Utility
        Agent configuration has been saved. Review this selection if you already
        have settings from an earlier version.
      </P>
      <P>
        A supported external Profile can use a separate model preference for
        Utility tasks when its harness exposes model selection. Otherwise it
        uses the harness default. The Utility Agent does not change which
        Profile an existing conversation uses.
      </P>
      <Callout tone="info">
        The selected Utility Agent must remain connected and authenticated.
        Huabu does not silently switch to Built-In Pi when that agent is
        unavailable. Background tasks cannot wait for interactive tool approval.
        Automatic Huabu Memory curation currently requires Built-In Pi as the
        Utility Agent; the built-in Skill authoring flow also remains separate
        from external agents.
      </Callout>

      <H2>Optional Built-In Pi</H2>
      <P>
        If you prefer Huabu&apos;s built-in Chat and Agent, expand{' '}
        <strong>Built-In Pi</strong> under <strong>Settings &gt; Agent</strong>{' '}
        and open its configuration. Choose a provider, complete its credentials
        or sign-in, and select a Chat Model or Azure OpenAI Deployment. These
        settings are not required for external Agent Profiles.
      </P>
      <P>
        Built-In Pi has its own Chat Model and Utility Model settings. For
        providers with multiple models, the conversation can select a different
        model without changing the Settings default; Azure OpenAI uses the
        configured Deployment. To use Pi for background work, explicitly select
        it under <strong>Utility tasks</strong>.
      </P>

      <H2>Image understanding</H2>
      <P>
        Image input depends on both the connected agent&apos;s ACP support and
        the selected model&apos;s vision capability. The same requirement
        applies to external Utility tasks that inspect images. Huabu does not
        fall back to a built-in model when an external agent cannot process an
        image. Built-In Pi uses its own model configuration for image input.
      </P>

      <H2>Image generation</H2>
      <P>
        Huabu&apos;s Image Generation integration is separate from Agent
        Profiles. Configure it in <strong>Settings &gt; Services</strong> when
        you want to use that integration. Connecting an agent does not configure
        Huabu&apos;s service credentials. An agent may also provide image tools
        of its own, subject to its harness and permissions.
      </P>

      <H2>Web search and video transcripts</H2>
      <Table
        headers={['Capability', 'What it enables', 'Setup']}
        rows={[
          [
            <strong>Web Search</strong>,
            'Provides the Huabu web-search integration; connected agents may also have their own search tools.',
            'Configure the search service under Settings > Services.',
          ],
          [
            <strong>YouTube Transcripts</strong>,
            'Lets Huabu import transcript text when processing YouTube material.',
            'Configure the transcript service under Settings > Services.',
          ],
          [
            <strong>OCR</strong>,
            'Adds text-recognition evidence when interpreting handwritten input.',
            'Configure the OCR service under Settings > Services.',
          ],
        ]}
      />
      <Callout tone="info">
        Connecting an agent is not a guarantee that every model or tool
        capability is available. Huabu services and an agent&apos;s own tools
        have separate setup, accounts, and usage charges. Skills provide
        instructions; they do not supply missing tools or credentials.
      </Callout>
    </PageLayout>
  );
}
