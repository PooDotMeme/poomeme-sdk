# poo

Build a POO.MEME module on your own machine, against the real platform, with nothing running but
Foundry.

```
poo init my-module      scaffold a module project that builds and tests offline
poo dev                 stand a chain up and run your module on it, end to end
poo preview             draw the token page your manifest asks for
poo check               compile it and hold every import to the published surface
poo publish             publish a deployed factory to a module registry
```

## What you install

Node 22 or newer, and [Foundry](https://getfoundry.sh). Then:

```
npm install -g @poomeme/sdk
poo init my-module
```

Nothing else — the package carries the platform, and `poo init` writes it into your project's
`lib/poo-sdk`, so there is no `forge install` step, no RPC, and no account.

## What you get

```
my-module/
  foundry.toml            solc 0.8.36, cancun, via-IR — the settings POO.MEME itself builds with
  remappings.txt          the roots your sources may use, and the ones only your tests may
  src/MyModule.sol        the contract a token installs
  src/MyModuleFactory.sol its manifest, its probe, and how instances are made
  test/MyModule.t.sol     a whole platform, stood up in memory, that publishes your module
  script/Poo.s.sol        that same platform, deployed — `poo dev` and `poo preview` run it
  lib/poo-sdk/            the platform
```

`forge test` in that directory installs a registry, a token factory, a Uniswap V2 venue and a
metadata registry into a throwaway EVM, then calls the real `publishTokenModule` on the real
registry. If your manifest is wrong, you find out there, by the name of the Solidity error that
refused it — not after a deployment.

## The loop

`poo dev` starts an Anvil on 127.0.0.1, deploys the whole platform onto it — venue registry, module
registry, token factory, metadata, verification, Uniswap V2 at its canonical addresses — publishes
your factory to that registry, and creates a token that installs your module. It prints every
address, writes them to `.poo/dev.json`, and holds the chain until you stop it. Point `cast`, a
wallet or a test at it. Nothing of POO.MEME's is running, and nothing reaches the network: Anvil is
Foundry's and the chain has no fork URL.

It is `script/Poo.s.sol` that does this, and that file is yours. The dev token's name, supply and
your module's config live at the top of it, so when your config stops being one `uint256` you change
it there. `poo dev --rpc <url>` uses a chain you already have instead of starting one.

A token needs a launch module, and the module surface deliberately carries none — a launch is
somebody's module, not the platform's. So the devkit ships the smallest launch the registry will
accept, and `poo dev` publishes that one to give your token a route. It is test scaffolding, in
`lib/poo-sdk/devkit/`, and your own sources still may not import it.

## The page your manifest asks for

A manifest is a module's entire user interface, and until now you found out what it looked like
after you published it. `poo preview` stands the platform up inside one EVM that never existed,
builds your factory, reads `manifest()` off it, and draws the seats: every section, its column
grid, what each item spans, the widget and unit behind each figure, which views need a viewer,
which ones hide behind a condition, every action with its inputs, every event with its tone. Then
it asks the real registry to publish it and tells you the answer by the name of the error.

It reads nothing of ours over the wire — no RPC, no API, no key. The words, units, order and
widths are yours; the pixels are the platform's.

## Publishing

`poo publish` is the only command that reaches a chain that is not yours, and it refuses rather
than half-finishes. Before it sends anything it checks that the address you named holds code, that
the manifest there is this checkout's byte for byte, that the registry would accept it at all, that
you are the factory's developer, that the handle is free or already yours, and that this factory
is not published twice. It reads `publishFee()` and sends exactly that, because the registry
refuses any other amount.

Without `--broadcast` it only checks. With it, `cast` signs — pass your own signing flags after
`--`, and the SDK never sees a key:

```
poo publish --rpc <url> --registry 0x… --factory 0x… --broadcast -- --ledger
```

Run it first against your own `poo dev` chain, where `--registry` comes from `.poo/dev.json`: the
same checks, the same transaction, nothing at stake.

## What you write

A **module** is a contract a token calls. It implements `IPooTokenModule` and, if it wants to hear
about trades, one or more hook interfaces: `IPooTrackHook`, `IPooReceiveHook`, `IPooGateHook`,
`IPooOperateOnSellHook`, `IPooOperateOnBuyHook`. Each one you declare raises the gas floor of every token that
installs you, for the life of that token — so declare the ones you use and no more.

Every hook you declare needs a gas cap in the manifest — `gateGas`, `trackGas`, `receiveGas`
and `operateGas` — and a cap without its hook, or a hook without its cap, is refused. Each
cap has a ceiling the registry will not publish past, because a token has to be able to afford
every module it installed in one transaction. The ceilings are constants on the surface, in
`@token-module/TokenModuleTypes.sol`, and `poo preview` prints your cap against the ceiling it
answers to. A module may declare `operate` or `work`, never both.

`IPooGateHook.gate` is asked about buys, and deliberately not about the pair's own LP burns and
skims. Every transfer out of the canonical pair looks like a buy, so a max-wallet Gate would
otherwise refuse a holder withdrawing liquidity or anyone skimming the pair's surplus. The token
reads the pair's supply and reserves before it calls the Gates and skips them in exactly those two
cases, so write your gate for buyers.

There is no tax interface to declare and no tax entry to publish. A token's tax is the token's own,
fixed at creation. What a module earns is a row of the token's own tax table, paid in the asset its
manifest declares in `requires.taxAsset` — the quote asset or the token itself — and
`IPooReceiveHook.onReceive(address asset, uint256 buyAmount, uint256 sellAmount)` is how it is told
what arrived.

A **factory** makes instances of it and carries the **manifest** — the Solidity value that tells the
token page what to render: your config fields, your views, your actions, your events. The manifest is
data, immutable, and read straight off the chain, so the page a holder sees is the page your factory
declared.

A **probe** is one instance your factory builds in its own constructor, on the registry's stand-in:
`IPooProbeHost(registry).probeStandIn()` answers as the token and the pair, and the probe takes it
for every context field. The registry interrogates the probe before it will publish you: it calls
every selector your manifest names, and it calls every hook you declared through the stand-in,
inside the gas you declared for it. A manifest that promises something the code does not answer is
refused, and so is a probe whose token is anything but the stand-in.

## What refuses you

The registry, its manifest checks and the handle namespace declare more than a hundred named
refusals between them. `forge test` and `poo preview` show you them by name:
`SelectorNotAnswered`, `ProbeConfigInvalid`, `GasWithoutHook`, `GasCapAboveCeiling`,
`ItemUnreferenced`, `HandleUnavailable`, `EventSignatureMismatch`, and the rest.

`poo check` refuses one thing the compiler will not: an import that reaches past the published
surface. Your sources may import interfaces, types and pure libraries — `poo init` and `poo check`
both print how many files that is.
They may not import the platform's implementation, and they may not import the test devkit, even
though both are sitting in `lib/poo-sdk` so your tests can use them. The check is by file, not by
spelling, so renaming a remapping does not get you past it.

```
src/MyModule.sol:9  imports @token/PooToken.sol
    src/token/PooToken.sol is platform implementation — a module declares against interfaces
    and types, never against one
```

## Your handle

`m.handle` in the manifest is your module family's handle: 3 to 31 bytes of `a-z`, `0-9` and `-`,
starting with a letter. The first wallet to publish under it holds it for the module family, and
every later publication under that handle must come from the same wallet. Wallets and module
families share one namespace, so a handle a wallet holds cannot be published under, and a handle
POO.MEME has dropped cannot be used at all. Pick it before you publish, not after.

## Where the platform comes from

`poo assemble` builds `lib/poo-sdk` from the platform's own tree, which is the only place that
Solidity exists — the package is generated, never copied by hand, so it cannot fall behind the
contracts it describes. Packing the CLI runs it, so an installed `poo init` scaffolds against the
platform its version was built from. From a checkout, `node sdk/bin/poo.mjs init my-module`
reassembles from the tree on every run instead.
