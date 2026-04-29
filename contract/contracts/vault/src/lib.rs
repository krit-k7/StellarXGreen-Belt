#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, IntoVal, String, Symbol, vec};

/// Represents a completed remittance record
#[contracttype]
#[derive(Clone)]
pub struct RemittanceRecord {
    pub sender: Address,
    pub amount_xlm: i128,
    pub dest_currency_code: u32, // e.g. 1=USD, 2=EUR, 3=INR, 4=PHP, 5=MXN
    pub converted_amount: i128,  // destination currency units (scaled x100)
    pub ledger_timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    SentTotal(Address),        // total XLM sent by address
    RemittanceCount,           // global count of remittances
    GlobalVolume,              // total XLM volume
}

#[contract]
pub struct RemittanceRouter;

#[contractimpl]
impl RemittanceRouter {
    /// Routes a remittance: records the transfer on-chain and calls the
    /// ExchangeLedger contract to log the converted destination amount.
    /// This demonstrates the inter-contract call pattern in a real-world context.
    pub fn send_remittance(
        env: Env,
        exchange_ledger: Address,
        sender: Address,
        recipient: Address,
        amount_xlm: i128,
        dest_currency_code: u32,
    ) -> i128 {
        // Track per-sender volume
        let sender_key = DataKey::SentTotal(sender.clone());
        let prev_sent: i128 = env.storage().persistent().get(&sender_key).unwrap_or(0);
        env.storage().persistent().set(&sender_key, &(prev_sent + amount_xlm));

        // Update global stats
        let count: u64 = env.storage().persistent().get(&DataKey::RemittanceCount).unwrap_or(0);
        env.storage().persistent().set(&DataKey::RemittanceCount, &(count + 1));

        let vol: i128 = env.storage().persistent().get(&DataKey::GlobalVolume).unwrap_or(0);
        env.storage().persistent().set(&DataKey::GlobalVolume, &(vol + amount_xlm));

        // Inter-contract call: ask ExchangeLedger to record the converted amount
        // and return the destination-currency value
        let converted: i128 = env.invoke_contract(
            &exchange_ledger,
            &Symbol::new(&env, "record_transfer"),
            vec![
                &env,
                sender.into_val(&env),
                recipient.clone().into_val(&env),
                amount_xlm.into_val(&env),
                dest_currency_code.into_val(&env),
            ]
        );

        // Emit event for real-time frontend streaming
        env.events().publish(
            (Symbol::new(&env, "remittance"), Symbol::new(&env, "sent")),
            (recipient, amount_xlm, dest_currency_code, converted),
        );

        converted
    }

    /// Returns total XLM sent by a specific user
    pub fn get_user_total(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::SentTotal(user)).unwrap_or(0)
    }

    /// Returns the total number of remittances processed
    pub fn get_remittance_count(env: Env) -> u64 {
        env.storage().persistent().get(&DataKey::RemittanceCount).unwrap_or(0)
    }

    /// Returns the total XLM volume routed through this contract
    pub fn get_global_volume(env: Env) -> i128 {
        env.storage().persistent().get(&DataKey::GlobalVolume).unwrap_or(0)
    }
}

mod test;
