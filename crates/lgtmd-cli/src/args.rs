use lgtmd::Result;
use std::{collections::BTreeSet, path::PathBuf};

pub const HELP: &str = "lgtmd — documentation from completed application flows

Usage: lgtmd <dev|build|preview|check|update> [options]
  --config PATH                 Passive JSON config (default ./lgtmd.config.json)
  --audience reader|contributor Reader is the default
  dev --watch                   Rerun the whole flow on configured input changes
  dev --reuse                   Read retained output without executing authoring
  dev --base REF                Compare the exact Git revision (default HEAD)
  dev|preview --port PORT        Loopback port (default 4177; 0 chooses a free port)
  update --candidate ID         Accept exactly the reviewed immutable candidate
  --help | --version             No config or authoring required
";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Options {
    pub command: String,
    pub config: Option<PathBuf>,
    pub audience: String,
    pub port: u16,
    pub reuse: bool,
    pub watch: bool,
    pub base: Option<String>,
    pub candidate: Option<String>,
}

pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Options> {
    let mut args = args.into_iter();
    let command = args.next().unwrap_or_else(|| "help".into());
    let mut options = Options {
        command: command.clone(),
        config: None,
        audience: "reader".into(),
        port: 4177,
        reuse: false,
        watch: false,
        base: None,
        candidate: None,
    };
    if ["--help", "-h", "help", "--version", "-v"].contains(&command.as_str()) {
        if args.next().is_some() {
            return Err("Unexpected arguments".into());
        }
        return Ok(options);
    }
    if !["dev", "build", "preview", "check", "update"].contains(&command.as_str()) {
        return Err(format!("Unknown command: {command}"));
    }
    let mut seen = BTreeSet::new();
    while let Some(option) = args.next() {
        if !seen.insert(option.clone()) {
            return Err(format!("Duplicate option: {option}"));
        }
        match option.as_str() {
            "--help" | "-h" => options.command = "help".into(),
            "--watch" | "--reuse" => {
                if command != "dev" {
                    return Err(format!("{option} is only supported by dev"));
                }
                if option == "--watch" {
                    options.watch = true;
                } else {
                    options.reuse = true;
                }
            }
            "--config" | "--audience" | "--port" | "--base" | "--candidate" => {
                let value = args
                    .next()
                    .filter(|s| !s.is_empty() && !s.starts_with("--"))
                    .ok_or_else(|| format!("Missing value for {option}"))?;
                match option.as_str() {
                    "--config" => options.config = Some(value.into()),
                    "--audience" => {
                        if !["reader", "contributor"].contains(&value.as_str()) {
                            return Err("Audience must be reader or contributor".into());
                        }
                        options.audience = value;
                    }
                    "--port" => {
                        if !["dev", "preview"].contains(&command.as_str()) {
                            return Err("--port is only supported by dev/preview".into());
                        }
                        if !value.bytes().all(|b| b.is_ascii_digit()) {
                            return Err("Port must be 0–65535".into());
                        }
                        options.port = value.parse().map_err(|_| "Port must be 0–65535")?;
                    }
                    "--base" => {
                        if command != "dev" {
                            return Err("--base is only supported by dev".into());
                        }
                        options.base = Some(value);
                    }
                    "--candidate" => {
                        if command != "update" {
                            return Err("--candidate is only supported by update".into());
                        }
                        options.candidate = Some(value);
                    }
                    _ => unreachable!(),
                }
            }
            _ => return Err(format!("Unknown option: {option}")),
        }
    }
    if options.reuse && options.watch {
        return Err("--reuse and --watch cannot be combined".into());
    }
    if options.command == "update" && options.candidate.is_none() {
        return Err("update requires --candidate ID".into());
    }
    Ok(options)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Result<Options> {
        parse(values.iter().map(|s| (*s).to_owned()))
    }
    #[test]
    fn fails_before_config_or_authoring() {
        for command in [
            vec!["dev", "--watch", "--reuse"],
            vec!["update"],
            vec!["build", "--port", "0"],
            vec!["dev", "--port", "65536"],
            vec!["dev", "--port", "+1"],
            vec!["dev", "--audience", "private"],
            vec!["dev", "--port", "0", "--port", "1"],
        ] {
            assert!(args(&command).is_err(), "{command:?}");
        }
        assert_eq!(args(&["dev", "--port", "0"]).unwrap().port, 0);
        assert_eq!(args(&["dev", "--help"]).unwrap().command, "help");
        assert_eq!(args(&[]).unwrap().command, "help");
    }
}
