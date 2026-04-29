#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_record_transfer_usd() {
    let env = Env::default();
    let contract_id = env.register(ExchangeLedger, ());
    let client = ExchangeLedgerClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    // 1000 XLM → USD: rate=11, 1000*11/100 = 110
    let converted = client.record_transfer(&sender, &recipient, &1000, &1u32);
    assert_eq!(converted, 110i128);
    assert_eq!(client.get_total_received(&recipient), 110i128);
    assert_eq!(client.get_transfer_count(&1u32), 1u64);
}

#[test]
fn test_record_transfer_inr() {
    let env = Env::default();
    let contract_id = env.register(ExchangeLedger, ());
    let client = ExchangeLedgerClient::new(&env, &contract_id);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    // 200 XLM → INR: rate=916, 200*916/100 = 1832
    let converted = client.record_transfer(&sender, &recipient, &200, &3u32);
    assert_eq!(converted, 1832i128);
}

#[test]
fn test_rate_retrieval() {
    let env = Env::default();
    let contract_id = env.register(ExchangeLedger, ());
    let client = ExchangeLedgerClient::new(&env, &contract_id);

    assert_eq!(client.get_rate(&1u32), 11i128);   // USD
    assert_eq!(client.get_rate(&2u32), 10i128);   // EUR
    assert_eq!(client.get_rate(&3u32), 916i128);  // INR
    assert_eq!(client.get_rate(&4u32), 637i128);  // PHP
    assert_eq!(client.get_rate(&5u32), 194i128);  // MXN
}

#[test]
fn test_admin_rate_override() {
    let env = Env::default();
    let contract_id = env.register(ExchangeLedger, ());
    let client = ExchangeLedgerClient::new(&env, &contract_id);

    // Override USD rate
    client.set_rate(&1u32, &15i128);
    assert_eq!(client.get_rate(&1u32), 15i128);

    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    // 100 XLM → USD at new rate: 100*15/100 = 15
    let converted = client.record_transfer(&sender, &recipient, &100, &1u32);
    assert_eq!(converted, 15i128);
}
