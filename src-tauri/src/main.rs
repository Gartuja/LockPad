#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod crypto;
mod models;
mod updater;
mod vault;

fn main() {
    app::run()
}
