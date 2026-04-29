#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

/// Exchange rates stored as basis points relative to 1 XLM
/// e.g. 1 XLM = N units of dest currency (scaled x100 for precision)
/// Currency codes: 1=USD, 2=EUR, 3=INR, 4=PHP, 5=MXN
#[contracttype]
pub enum DataKey {
    Rate(u32),                    // rate for currency code
    TotalReceived(Address),       // total converted units received (per sender)
    TransferCount(u32),           // count of transfers per currency
    AdminRate(u32),               // admin-set rate override
}

#[contract]
pub struct ExchangeLedger;

#[contractimpl]
impl ExchangeLedger {
    /// Records a remittance transfer and returns the converted destination amount.
    /// This is called via inter-contract invocation from the RemittanceRouter.
    /// Rate logic: apply on-chain exchange rates (simulated oracle).
    pub fn record_transfer(
        env: Env,
        sender: Address,
        recipient: Address,
        amount_xlm: i128,
        dest_currency_code: u32,
    ) -> i128 {
        // Fetch the exchange rate (units of dest currency per 1 XLM, scaled x100)
        let rate = Self::get_rate(env.clone(), dest_currency_code);

        // Convert: amount_xlm * rate / 100
        let converted = (amount_xlm * rate) / 100;

        // Track per-recipient received amounts
        let key = DataKey::TotalReceived(recipient);
        let prev: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(prev + converted));

        // Track transfer count per currency
        let cnt_key = DataKey::TransferCount(dest_currency_code);
        let cnt: u64 = env.storage().persistent().get::<_, u64>(&cnt_key).unwrap_or(0);
        env.storage().persistent().set(&cnt_key, &(cnt + 1));

        converted
    }

    /// Returns the simulated exchange rate for a currency code (scaled x100).
    /// In production, this would integrate a real price oracle.
    pub fn get_rate(env: Env, currency_code: u32) -> i128 {
        // Check if admin override exists
        if let Some(admin_rate) = env.storage().persistent().get::<_, i128>(&DataKey::AdminRate(currency_code)) {
            return admin_rate;
        }
        // Default hardcoded testnet rates (XLM → dest currency, scaled x100)
        // These simulate real-world rates for demonstration
        match currency_code {
            1 => 11,   // 1 XLM ≈ 0.11 USD  → 11 (scaled x100)
            2 => 10,   // 1 XLM ≈ 0.10 EUR
            3 => 916,  // 1 XLM ≈ 9.16 INR  → 916 (scaled x100)
            4 => 637,  // 1 XLM ≈ 6.37 PHP
            5 => 194,  // 1 XLM ≈ 1.94 MXN
            _ => 11,   // default USD
        }
    }

    /// Allows admin to update exchange rates (simulates oracle feed)
    pub fn set_rate(env: Env, currency_code: u32, rate_scaled: i128) {
        env.storage().persistent().set(&DataKey::AdminRate(currency_code), &rate_scaled);
    }

    /// Returns total converted units received for a recipient
    pub fn get_total_received(env: Env, recipient: Address) -> i128 {
        env.storage().persistent().get(&DataKey::TotalReceived(recipient)).unwrap_or(0)
    }

    /// Returns transfer count for a currency
    pub fn get_transfer_count(env: Env, currency_code: u32) -> u64 {
        env.storage().persistent().get::<_, u64>(&DataKey::TransferCount(currency_code)).unwrap_or(0)
    }
}

mod test;
