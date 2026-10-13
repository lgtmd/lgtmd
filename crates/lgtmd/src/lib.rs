#![doc = include_str!("../README.md")]

mod artifact;
mod authoring;
pub mod handoff;
mod layout;
pub mod lifecycle;
mod manifest;
mod markdown;
mod model;
mod paths;
mod prose;
mod render;
pub mod review;
pub mod runner;
pub mod site;
pub mod store;
pub mod transport;
mod validation;

pub use artifact::Artifact;
pub use authoring::Doc;
pub use layout::ExportLayout;
pub use model::{
    Audience, Binding, BindingValue, Block, Checked, Claim, Document, IntoProse, Observed, Prose,
    Resource, Target,
};
pub use render::{render, render_with};

pub type Result<T> = std::result::Result<T, String>;

/// Combine text and typed handles without losing evidence references.
/// The expression-list form returns a sequence; named interpolation returns
/// `Result<Prose>` and rejects missing, duplicate, or unused bindings.
/// Each supplied expression is evaluated once, in order, through [`IntoProse`].
#[macro_export]
macro_rules! prose {
    ($text:literal, $($name:ident = $value:expr),+ $(,)?) => {
        $crate::Prose::interpolate(
            $text,
            [$( (::std::stringify!($name), $crate::IntoProse::into_prose($value)) ),+],
        )
    };
    ($($part:expr),* $(,)?) => {{
        let parts: ::std::vec::Vec<$crate::Prose> =
            ::std::vec![$($crate::IntoProse::into_prose($part)),*];
        parts
    }};
}
