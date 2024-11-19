import { Buffer } from "node:buffer";
import {
  AssetId,
  Bip32PrivateKey,
  CredentialType,
  Hash28ByteBase16,
  mnemonicToEntropy,
  NetworkId,
  RewardAccount,
  TransactionId,
  TransactionInput,
  wordlist,
} from "npm:@blaze-cardano/core@0.5.0";
import {
  Blaze,
  Constr,
  Core,
  Data,
  HotWallet,
  makeValue,
  Blockfrost,
  Static,
} from "npm:@blaze-cardano/sdk";

import { SEED } from "./secret.ts";


const V1_TUNA_POLICY_ID = '279f842c33eed9054b9e3c70cd6a3b32298259c24b78b895cb41d91a';
const V2_TUNA_POLICY_ID = 'c981fc98e761e3bb44ae35e7d97ae6227f684bcb6f50a636753da48e';
const HARD_FORK_HASH = '33443d66138f9609e86b714ff5ba350702ad7d4e476e4cba40cae696';
const TUNA_ASSET_NAME = '54554e41';


const provider = new Blockfrost(
  {
    network: "cardano-mainnet",
    projectId: "mainnetuRUrQ38l0TbUCUbjDDRNfi8ng1qxCtpT",
  }
)

const entropy = mnemonicToEntropy(SEED, wordlist);
const masterkey = Bip32PrivateKey.fromBip39Entropy(Buffer.from(entropy), "");
const wallet = await HotWallet.fromMasterkey(
  masterkey.hex(),
  provider,
  NetworkId.Mainnet,
);

const blaze = await Blaze.from(provider, wallet);

const forkValidatorAddress = Core.Address.fromBech32(
  "addr1wye5g0txzw8evz0gddc5lad6x5rs9ttaferkun96gr9wd9sj5y20t",
);

const rewardAccount = RewardAccount.fromCredential(
  {
    type: CredentialType.ScriptHash,
    hash: Hash28ByteBase16(HARD_FORK_HASH),
  },
  NetworkId.Mainnet,
);


const mintRedeemer = Data.to(new Constr(2, []));

const amountToRedeem = 200000000n;

const forkScriptRef = new TransactionInput(
  TransactionId(
    "55897091192254abbe6501bf4fd63f4d9346e9c2f5300cadfcbe2cda25fd6351",
  ),
  0n,
);

const mintScriptRef = new TransactionInput(
  TransactionId(
    "80874829afb2cb34e23d282d763b419e26e9fb976fe8a7044eebbdf6531214b7",
  ),
  0n,
);


const WithdrawRedeemerSchema = Data.Enum([
  Data.Object({ HardFork: Data.Object({ lockOutputIndex: Data.Integer() }) }),
  Data.Object({
    Lock: Data.Object({
      lockOutputIndex: Data.Integer(),
      lockingAmount: Data.Integer(),
    }),
  }),
]);

type WithdrawRedeemer = Static<typeof WithdrawRedeemerSchema>;
const WithdrawRedeemer = WithdrawRedeemerSchema as unknown as WithdrawRedeemer;

const withdrawRedeemerData = {
  Lock: {
    lockOutputIndex: 0n,
    lockingAmount: amountToRedeem,
  },
};

const withdrawRedeemer = Data.to(withdrawRedeemerData, WithdrawRedeemer);


const lockStateAssetId = AssetId(HARD_FORK_HASH + "6c6f636b5f7374617465");

const tunaV1AssetId = AssetId(V1_TUNA_POLICY_ID + TUNA_ASSET_NAME);
const tunaV2AssetId = AssetId(V2_TUNA_POLICY_ID + TUNA_ASSET_NAME);

const lockUtxo = await blaze.provider.getUnspentOutputByNFT(lockStateAssetId);

const refOutputs = await blaze.provider.resolveUnspentOutputs([
  forkScriptRef,
  mintScriptRef,
]);

const UnlockRedeemerSchema = Data.Enum([
  Data.Object({ Mint: Data.Object({ zero: Data.Integer() }) }),
  Data.Object({ Spend: Data.Object({ zero: Data.Integer() }) })
]);

type UnlockRedeemer = Static<typeof UnlockRedeemerSchema>;
const UnlockRedeemer = UnlockRedeemerSchema as unknown as UnlockRedeemer;
const unlockRedeemerData = {
  Spend: { zero: 0n },
}

const unlockRedeemer = Data.to(unlockRedeemerData, UnlockRedeemer);


const LockDatum = Data.Object({
  blockHeight: Data.Integer(),
  currentLockedTuna: Data.Integer(),  
});

type LockDatum = Static<typeof LockDatum>;

const lockDatum = Data.from(
  lockUtxo.output().datum()!.asInlineData()!,
  LockDatum,
);



const currentLockedTuna = lockDatum.currentLockedTuna + amountToRedeem;

const outputLockDatum = Data.to(
  {
    blockHeight: lockDatum.blockHeight,
    currentLockedTuna,
  },
  LockDatum,
);

const txRaw = await blaze
  .newTransaction()
  .addReferenceInput(refOutputs[0])
  .addReferenceInput(refOutputs[1])
  .addInput(lockUtxo, unlockRedeemer)
  .lockAssets(
    forkValidatorAddress,
    makeValue(0n, [lockStateAssetId, 1n], [tunaV1AssetId, currentLockedTuna]),
    outputLockDatum,
  )
  .addMint(
    AssetId.getPolicyId(tunaV2AssetId),
    new Map([[AssetId.getAssetName(tunaV2AssetId), amountToRedeem]]),
    mintRedeemer,
  )
  .addWithdrawal(rewardAccount, 0n, withdrawRedeemer)
  .complete();


const signedTx = await blaze.signTransaction(txRaw);

const txId = await blaze.wallet.postTransaction(signedTx);

console.log(`Transaction ID: ${txId}`)