# Save a valid configuration

<a id="block-0001"></a>

Use **config-demo** to validate a JSON configuration before saving it.
The command reports a useful error when a value is invalid and keeps the last
valid output available while you correct the input.

This walkthrough shows how to:

- Save a valid configuration.
- Reject an invalid replacement without changing the saved file.
- Correct the input and retry successfully.

Run the commands from a scratch directory so that `input.json` and
`settings.json` stay together.

<a id="block-0002"></a>

The configuration contains one setting: port\. Choose an integer from 1 to 65535\. The Rust API's default configuration uses port 8080\. The command line reads an explicit configuration file; it does not fill in a missing port\.

<a id="block-0003"></a>

## Save a configuration

<a id="block-0004"></a>

Create input\.json with this content:

<a id="block-0005"></a>

```json
{
  "port": 9090
}
```

<a id="block-0006"></a>

Pass the input file and an output path\. A successful command saves the validated configuration:

<a id="block-0007"></a>

```text
$ config-demo input.json --output settings.json
Saved validated configuration (port 9090) to settings.json.
[exit 0]
```

<a id="block-0008"></a>

The saved settings\.json now contains port 9090\. Its contents are shown below, and you can also open the [saved\-configuration](assets/configure-a-port/saved-configuration.json) file directly\.

<a id="block-0009"></a>

```json
{
  "port": 9090
}
```

<a id="block-0010"></a>

## Reject an invalid replacement

<a id="block-0011"></a>

A rejected input leaves an existing output unchanged\. To see this, replace input\.json with an invalid port:

<a id="block-0012"></a>

```json
{
  "port": 0
}
```

<a id="block-0013"></a>

Run the same command again\. The error explains which value needs correction:

<a id="block-0014"></a>

```text
$ config-demo input.json --output settings.json
Configuration rejected: port must be between 1 and 65535 (received 0).
[exit 2]
```

<a id="block-0015"></a>

The command exits unsuccessfully and preserves every byte of settings\.json\. The [saved\-configuration](assets/configure-a-port/saved-configuration.json) from the first command is still the current configuration\.

<a id="block-0016"></a>

## Correct the input and retry

<a id="block-0017"></a>

Change the port in input\.json to 8080 and rerun the command\. The same output path can now be replaced with a valid configuration:

<a id="block-0018"></a>

```text
$ config-demo input.json --output settings.json
Saved validated configuration (port 8080) to settings.json.
[exit 0]
```

<a id="block-0019"></a>

The output now uses port 8080\. When validation fails, correct the input and retry; the last valid output remains available until the correction succeeds\.

