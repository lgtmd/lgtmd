# Parse a typed JSON list

<a id="block-0001"></a>

Use `serde_json::from_str::<Vec<u32>>()` to read a JSON array of
unsigned integers into a Rust vector. The Rust type supplies a concrete
expectation: a string inside the array is a type mismatch, even if the JSON
syntax is valid.

This walkthrough parses a valid list, inspects an error, and retries with
corrected input. It calls the public `serde_json` API directly.

The library documents [deserializing from a string](https://docs.rs/serde_json/1.0.151/serde_json/fn.from_str.html)
and [classifying errors](https://docs.rs/serde_json/1.0.151/serde_json/struct.Error.html).

<a id="block-0002"></a>

## Parse a valid list

<a id="block-0003"></a>

Start with this JSON array:

<a id="block-0004"></a>

```json
[2, 3, 5]
```

<a id="block-0005"></a>

Parsing succeeds with 3 integers\. Their sum is 10\. The values are ordinary Rust integers after deserialization\.

<a id="block-0006"></a>

## Inspect a type mismatch

<a id="block-0007"></a>

Replace the second number with a string. This input is still valid JSON,
but it does not match `Vec<u32>`:

<a id="block-0008"></a>

```json
[2, "three", 5]
```

<a id="block-0009"></a>

The failed parse returns an error\. Its display text identifies the incompatible value and the expected Rust type:

<a id="block-0010"></a>

```text
invalid type: string "three", expected u32 at line 1 column 11
```

<a id="block-0011"></a>

The error is classified as Data and is reported at line 1, column 11\. Use the category to distinguish a type mismatch from invalid JSON syntax\.

<a id="note-0001"></a>

> **Contributor note on [type\-error](assets/parse-a-typed-list/type-error.txt):** The error text is captured from serde\_json 1\.0\.151\. A dependency update must review both the asserted category and the captured message\. The [error\-observation](assets/parse-a-typed-list/error-observation.json) records the observed diagnostic fields for contributors\.

<a id="block-0012"></a>

## Correct the input and serialize the result

<a id="block-0013"></a>

Replace the string with the number 3 and parse the corrected source again\. The corrected input is the same valid array shown above:

<a id="block-0014"></a>

```json
[2, 3, 5]
```

<a id="block-0015"></a>

The corrected parse returns \[2,3,5\]\. Pass that vector to serde\_json::to\_string\_pretty to obtain formatted JSON:

<a id="block-0016"></a>

```json
[
  2,
  3,
  5
]
```

<a id="block-0017"></a>

The [formatted\-list](assets/parse-a-typed-list/formatted-list.json) can be parsed back into the same integers\. Formatting changes the presentation while preserving these values\.

<a id="note-0002"></a>

> **Contributor note:** This integration is maintained here to test the documentation framework against an independently existing Rust library\. It is not upstream serde\_json documentation or evidence of adoption by its maintainers\.

