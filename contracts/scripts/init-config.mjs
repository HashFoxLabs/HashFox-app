import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
	sendAndConfirmTransaction
} from '@solana/web3.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PROGRAM_ID = new PublicKey('7ApsvRSqfqCA5YbSSvAmeboFFU7hyB2HJBCpEiwmLSSi');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const WALLET_PATH =
	process.env.WALLET_PATH || path.join(os.homedir(), '.config', 'solana', 'phantom.json');

function anchorDiscriminator(methodName) {
	const hash = crypto.createHash('sha256').update(`global:${methodName}`).digest();
	return hash.subarray(0, 8);
}

async function main() {
	const connection = new Connection(RPC_URL, 'confirmed');

	const walletData = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'));
	const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));

	console.log('RPC:', RPC_URL);
	console.log('Wallet:', wallet.publicKey.toBase58());
	console.log('Program:', PROGRAM_ID.toBase58());

	const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
	console.log('Config PDA:', configPDA.toBase58());

	const existing = await connection.getAccountInfo(configPDA);
	if (existing) {
		console.log('Config already initialized. Owner:', existing.owner.toBase58());
		return;
	}

	const treasuryKeypair = Keypair.generate();
	console.log('Treasury (generated):', treasuryKeypair.publicKey.toBase58());

	const discriminator = anchorDiscriminator('initialize_config');
	const data = Buffer.alloc(8 + 32);
	discriminator.copy(data, 0);
	treasuryKeypair.publicKey.toBuffer().copy(data, 8);

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: configPDA, isSigner: false, isWritable: true },
			{ pubkey: wallet.publicKey, isSigner: true, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data
	});

	console.log('Sending initialize_config…');
	const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [wallet], {
		commitment: 'confirmed'
	});

	console.log('Done. Tx:', sig);
	console.log('Authority:', wallet.publicKey.toBase58());
	console.log('Treasury:', treasuryKeypair.publicKey.toBase58());
	console.log('\nSAVE THIS TREASURY PUBKEY — it receives entry fees from user initializations.');

	fs.writeFileSync(
		path.join(process.cwd(), 'treasury.json'),
		JSON.stringify(Array.from(treasuryKeypair.secretKey))
	);
	console.log('Treasury keypair saved to treasury.json (backup this file).');
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('Error:', err);
		process.exit(1);
	});
