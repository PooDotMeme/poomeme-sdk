# POO.MEME Module SDK

The `poo` command.

Build a POO.MEME module on your own machine, against the real launcher and directory, with
nothing running but Foundry.

POO.MEME's live chain is public; a module is registered in `PooModuleDirectory` there directly —
`deployAndRegister(initcode, salt)`, or `publish(factory)` for one you already deployed. No fee, no
wallet-namespace claim and no admin: just a factory that answers the right selectors, refuses every caller
but POO.MEME's launcher, and carries a manifest the directory accepts. A launch installs a registered
factory and nothing else.

```
poo init my-module      scaffold a module project that builds and tests offline
poo check                hold every import to the published surface, and run the directory's own
                          manifest rules locally, before you ever call publish for real
poo preview               draw the token page your manifest asks for
poo abi                   print this module's and its factory's compiled ABI
```

## What you install

Node 22 or newer, and [Foundry](https://getfoundry.sh). Then:

```
npm install -g @poomeme/sdk
poo init my-module
```

Nothing else — the package carries the module surface and a devkit that stands the real launcher and
directory up in memory, so `poo init` writes it into your project's `lib/poo-sdk` and there is no
`forge install` step, no RPC and no account until you actually publish.

## What you get

```
my-module/
  foundry.toml               solc 0.8.36, cancun, via-IR — the settings POO.MEME itself builds with
  remappings.txt              @poomeme/ for the real POO.MEME sources, @core-test/ for its own vendored
                               test fixtures, @poo-devkit/ for the harness built on top of them
  src/MyModule.sol            the contract a token's splitter pays
  src/MyModuleFactory.sol     its manifest and how instances are made
  test/MyModule.t.sol         the real launcher, directory and a Pons stand-in, stood up in memory
  script/Poo.s.sol            that same devkit, deployed — poo preview reads it, forge script --tc Dev
                               runs it against a chain you already have
  script/Publish.s.sol        deploy (if needed) and publish to a real directory — dry run unless you
                               pass --broadcast
  lib/poo-sdk/                the module surface, the real launcher/directory/splitter for your tests,
                               and the Pons stand-in the launcher test suite itself uses
```

`forge test` in that directory deploys `PooModuleDirectory`, `PooLauncher` and a Pons stand-in into a
throwaway EVM, registers your factory in the real directory, mines a salt whose predicted token address
ends `0x8888` (`PooLauncher` refuses any other), launches a token that installs your module as one of
its fee legs, sends the splitter some ETH and collects it. If your manifest is wrong, you find out
there, by the name of the Solidity error that refused it — not after a deployment.

`DevkitHarness` (`@poo-devkit/ModuleHarness.sol`) carries the three calls that loop is built from:
`install` stands up the Pons stand-in, the directory and `PooLauncher` itself — its constructor also
takes a refund pricer, for the gas refund an ERC-20-paired launch pays — `request` builds a
`LaunchRequest` with its economics pin already set (`PooLauncher` refuses a launch whose pinned terms
have gone stale, `EconomicsMismatch`; the scaffold's own request launches against the chain's native
coin, leaving the type's `quote`, `quoteIn` and `snipeFeeExemptions` fields at their defaults), and
`vanity` mines the salt — call it right before `launcher.launch(r)`, as the scaffolded test does.

## The loop

`poo preview` builds your factory, deploys the same devkit inside one EVM that never existed, reads
`manifest()` off your factory, and draws the seats: every section, its column grid, what each item
spans, the widget and unit behind each figure, every action with its inputs, every event with its tone.
Then it calls the real `PooModuleDirectory.publish` and tells you the answer by the name of the error,
if there is one.

`poo check` compiles your project, refuses any import that reaches past the published surface (your
sources may import `@poomeme/pons/IPooModuleFactory.sol`, `ModuleManifestTypes.sol` and
`ModuleManifestLib.sol` — interfaces, types and one pure library, never the launcher or the directory
themselves), and then runs the exact rules `ModuleManifestCheckLib.sol` runs on chain — handle and
version characters, section and item shapes, action-selector recomputation, event-topic recomputation —
against your manifest in plain JavaScript, so every one of those refusals shows up by name before you
ever spend gas on `publish`.

Both read nothing of ours over the wire — no RPC, no API, no key. The words, units, order and widths are
yours; the pixels are the platform's.

## Publishing

There is no SDK command that reaches a chain that is not yours — `script/Publish.s.sol` is plain
`forge script`, so it already dry-runs by default and only sends anything with `--broadcast`:

```
forge script script/Publish.s.sol --rpc-url <url>                                          # dry run
DIRECTORY=0x… forge script script/Publish.s.sol --rpc-url <url> --broadcast --private-key <key>
```

`DIRECTORY` names the `PooModuleDirectory` to register with — on Robinhood Chain (4663),
`0xf4929EF6e8694f7D49A1b3818115c7b8F9039851`. Without `FACTORY` the script deploys and
registers your factory in one call, `deployAndRegister`, bound to the launcher that directory answers for
(`directory.launcher()`), at the address `directory.predictFactory(you, SALT, keccak256(initcode))` gives —
`SALT` is optional and defaults to zero, and if that address already holds your factory the script says it is
already registered and sends nothing. Pass `FACTORY` if you already deployed one and only want to `publish`
it. Run it first against a devkit chain of your own (`forge script script/Poo.s.sol --tc Dev --rpc-url <anvil>
--broadcast` stands one up), where nothing is at stake, before you ever point it at a real directory.

## What you write

A **module** is a contract the token's `PooSplitter` pays: it receives ETH from `collect()` as its
leg's share of the fees, and anyone may call the actions your manifest declares — there is no
permissioning the standard imposes beyond what your own contract chooses to enforce. Declare a
`receive()` if you want to accept that ETH at all; nothing requires you to.

A **factory** makes instances of it and implements `IPooModuleFactory`:

```solidity
interface IPooModuleFactory is IERC165 {
    error NotLauncher();

    function manifest() external view returns (ModuleManifest memory);
    function developer() external view returns (address);
    function launcher() external view returns (address);
    function create(ModuleContext calldata context, bytes calldata config) external returns (address module);
}

struct ModuleContext {
    address token;
    address splitter;
    address curve;
    address creator;
    uint16 bps;
    address quote;
    uint8 quoteDecimals;
}
```

`launcher()` is the one `PooLauncher` your factory serves — take it as a constructor argument and keep it
immutable. `create` must revert `NotLauncher()` for any other caller, **as its first statement**, before a
`nonReentrant` guard, a config check or any state write: the directory registers your factory only after
calling `create` itself, read-only, and seeing exactly that 4-byte error come back. The scaffolded factory
already does this; keep that line first.

`create` is called once per token, by `PooLauncher`, with the token, the splitter that will pay this
leg, the bonding curve, the token's creator, this leg's own share in basis points, and the launch's own
pair asset — `quote` (the zero address for the chain's native coin, else the Pons-approved ERC-20 the
launch is paired against) and `quoteDecimals`, the scale a config field or action input reads and encodes
amounts at. `config` is whatever bytes the creator supplied for this leg at launch — decode it yourself,
and refuse it if it is not what you expect.

The **manifest** is the Solidity value that tells the token page what to render: your name, handle and
version, your config fields, your sections of views and actions, your events and errors. It is data,
immutable, and read straight off the chain, so the page a holder sees is the page your factory declared.
`ModuleManifestLib` (in the published surface) is the small library both first-party factories and the
scaffold build one with — `ModuleManifestLib.base(...)`, `.figure(...)`, `.call(...)`, `.when(...)`,
`.items(...)`, `.logged(...)` — so you never hand-write a struct literal for a view or an action.

## What refuses you

`ModuleManifestCheckLib` and `PooModuleDirectory` between them declare every refusal `poo check` and
`poo preview` show you by name: `HandleInvalid`, `VersionInvalid`, `NameInvalid`, `SummaryInvalid`,
`ActionSelectorMismatch` (your declared selector does not match `name(type,type,...)` recomputed from
your own inputs), `ItemUnreferenced` (a view, action or list you declared that no item on the section's
grid points at), `EventSignatureMismatch` (your declared `topic0` does not match the signature you gave
it), `ManifestTooLarge` (over 16,384 bytes ABI-encoded), and — from the directory itself —
`NotAModuleFactory` (your contract does not answer `ERC165.supportsInterface` for `IPooModuleFactory`),
`WrongLauncher` (your factory's `launcher()` is not the launcher this directory is bound to),
`LauncherNotEnforced` (`create`, called by the directory, did not revert with exactly `NotLauncher()`),
`NotDeveloper` (you are not the address your factory's own `developer()` names), `AlreadyPublished`.
A launch naming a factory that is not registered, or whose code has changed since it registered, is refused
`NotRegistered`; one whose `launcher()` no longer answers this launcher is refused `WrongLauncher`.

There is no handle namespace: `m.handle` is a label the directory checks for shape (3 characters or more
of `a-z`, `0-9` and `-`, up to 32, never starting or ending with `-`) and nothing else — publishing does
not claim it, and nothing stops another factory from using the same one.

## Where the platform comes from

`poo assemble` builds `lib/poo-sdk` from this checkout's own `contracts/src/pons/` (and the
Pons interfaces and pool-key library it depends on) — the only place that Solidity exists — so the
package is generated, never copied by hand, and cannot fall behind the contracts it describes. Packing
the CLI runs it, so an installed `poo init` scaffolds against the platform its version was built from.
From a checkout, `node sdk/bin/poo.mjs init my-module` reassembles from the tree on every run instead.

The devkit's Pons stand-in (`lib/poo-sdk/core-test/`) is vendored the same way — from
`contracts/test/pons/PonsV2Mocks.sol` and `VanityMinerLib.sol`, the same fixtures the real launcher
test suite proves `PooLauncher` against, salt-mining included. Only the harness that wires them
together (`lib/poo-sdk/devkit/ModuleHarness.sol`, `sdk/devkit/*.sol` in this checkout) is hand-written.
