# Using Huabu Services

Use a Service Package when the task needs a configured provider. Huabu exposes discovery, credential-free Package guidance and downloads separately from private point-in-time configuration leases. This is not a generic provider proxy.

## Discover and inspect

```bash
huabu-rfs service list
huabu-rfs service manifest image-gen
huabu-rfs service skill image-gen
```

Select only a Service with `availableToExternalAgent: true`. Read its Skill and use the provider documentation it links. Manifest and Skill responses contain no credentials.

## Download and use a Package

```bash
huabu-rfs service download --out-folder . image-gen
cd image-gen
```

Read `SKILL.md`. With compatible Node, run `node entry.mjs --help` before invoking an optional entry because live help reflects the leased Manifest and configured defaults. Huabu provides the entry and `HUABU_SERVICE_SDK_URL`, not Node. The entry is a modifiable starting point, not a complete provider SDK; extend only a local Package copy and follow the official provider documentation.

## Lease configuration in a custom process

The RFS CLI deliberately does not print or export leases. When the entry cannot perform the required operation, write a business subprocess that consumes the existing language-independent lease API in memory, or use the Huabu-owned Node SDK below. Reject non-2xx responses and require one coherent `{ id, version, manifest, config }` result whose IDs and versions agree.

With compatible Node, the Huabu-owned SDK performs the same lease step:

```js
const { withServiceContext } = await import(process.env.HUABU_SERVICE_SDK_URL);
const result = await withServiceContext('image-gen', async (lease) => {
  return performProviderOperation(lease.manifest, lease.config);
});
```

Consume credentials only in memory and send them only to the intended provider. Do not print or persist the lease, provider headers or credentials, place them in argv/global shell environment, or expose them through diagnostics. A lease is a point-in-time snapshot, not a subscription or retry guarantee. After an ambiguous provider mutation failure, inspect provider state before deciding whether another operation is safe.
