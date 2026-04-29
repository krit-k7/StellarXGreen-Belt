#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, IntoVal};

// Inline the ExchangeLedger contract for integration testing
mod exchange_ledger {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

    #[contracttype]
    pub enum DataKey {
        Rate(u32),
        TotalReceived(Address),
        TransferCount(u32),
        AdminRate(u32),
    }

    #[contract]
    pub struct ExchangeLedger;

    #[contractimpl]
    impl ExchangeLedger {
        pub fn record_transfer(env: Env, sender: Address, recipient: Address, amount_xlm: i128, dest_currency_code: u32) -> i128 {
            let rate = Self::get_rate(env.clone(), dest_currency_code);
            let converted = (amount_xlm * rate) / 100;
            let key = DataKey::TotalReceived(recipient);
            let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            env.storage().persistent().set(&key, &(prev + converted));
            let cnt_key = DataKey::TransferCount(dest_currency_code);
            let cnt: u64 = env.storage().persistent().get::<_, u64>(&cnt_key).unwrap_or(0);
            env.storage().persistent().set(&cnt_key, &(cnt + 1));
            converted
        }

        pub fn get_rate(_env: Env, currency_code: u32) -> i128 {
            match currency_code {
                1 => 11,
                2 => 10,
                3 => 916,
                4 => 637,
                5 => 194,
                _ => 11,
            }
        }

        pub fn get_total_received(env: Env, recipient: Address) -> i128 {
            env.storage().persistent().get(&DataKey::TotalReceived(recipient)).unwrap_or(0)
        }
    }
}

#[test]
fn test_send_remittance_usd() {
    let env = Env::default();

    // Deploy ExchangeLedger contract
    let ledger_id = env.register(exchange_ledger::ExchangeLedger, ());
    let ledger_client = exchange_ledger::ExchangeLedgerClient::new(&env, &ledger_id);

    // Deploy RemittanceRouter contract
    let router_id = env.register(RemittanceRouter, ());
    let router_client = RemittanceRouterClient::new(&env, &router_id);

    let sender = Address::generate(&env);

    let recipient = Address::generate(&env);
    let converted = router_client.send_remittance(&ledger_id, &sender, &recipient, &1000, &1u32);

    assert_eq!(converted, 110i128, "1000 XLM should convert to 110 USD (scaled)");
    assert_eq!(router_client.get_user_total(&sender), 1000i128);
    assert_eq!(router_client.get_remittance_count(), 1u64);
    assert_eq!(router_client.get_global_volume(), 1000i128);
}

#[test]
fn test_send_remittance_inr() {
    let env = Env::default();

    let ledger_id = env.register(exchange_ledger::ExchangeLedger, ());
    let router_id = env.register(RemittanceRouter, ());
    let router_client = RemittanceRouterClient::new(&env, &router_id);

    let sender = Address::generate(&env);

    let recipient = Address::generate(&env);
    let converted = router_client.send_remittance(&ledger_id, &sender, &recipient, &500, &3u32);
    assert_eq!(converted, 4580i128, "500 XLM should convert to 4580 INR (scaled)");
}

#[test]
fn test_multiple_remittances_accumulate() {
    let env = Env::default();

    let ledger_id = env.register(exchange_ledger::ExchangeLedger, ());
    let router_id = env.register(RemittanceRouter, ());
    let router_client = RemittanceRouterClient::new(&env, &router_id);

    let sender = Address::generate(&env);

    let recipient = Address::generate(&env);
    router_client.send_remittance(&ledger_id, &sender, &recipient, &300, &1u32);
    router_client.send_remittance(&ledger_id, &sender, &recipient, &700, &1u32);

    assert_eq!(router_client.get_user_total(&sender), 1000i128);
    assert_eq!(router_client.get_remittance_count(), 2u64);
    assert_eq!(router_client.get_global_volume(), 1000i128);
}
