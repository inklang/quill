use async_trait::async_trait;
use crate::context::Context;
use crate::error::Result;

#[async_trait]
pub trait Command: Send + Sync {
    async fn execute(&self, ctx: &Context) -> Result<()>;
}

pub async fn execute(_ctx: &Context, _command: &crate::cli::Commands) -> Result<()> {
    // Stub - commands will be implemented in Chunk 6
    Ok(())
}
