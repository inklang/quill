use async_trait::async_trait;

use crate::commands::Command;
use crate::context::Context;
use crate::error::Result;

pub struct Run {
    pub no_watch: bool,
}

#[async_trait]
impl Command for Run {
    async fn execute(&self, _ctx: &Context) -> Result<()> {
        // Stub — full implementation in Task 4
        Ok(())
    }
}
