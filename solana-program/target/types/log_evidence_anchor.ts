/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/log_evidence_anchor.json`.
 */
export type LogEvidenceAnchor = {
  "address": "6enXBVJChBad8Bs7yYjZkwzxGvVtTW7hNok3YLep5tF3",
  "metadata": {
    "name": "logEvidenceAnchor",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "storeLogEvidence",
      "discriminator": [
        46,
        135,
        63,
        103,
        22,
        109,
        55,
        7
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "logRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103,
                  95,
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "deviceId"
              },
              {
                "kind": "arg",
                "path": "timestamp"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "deviceId",
          "type": "string"
        },
        {
          "name": "timestamp",
          "type": "i64"
        },
        {
          "name": "sha256Hex",
          "type": "string"
        },
        {
          "name": "ipfsCid",
          "type": "string"
        },
        {
          "name": "txRef",
          "type": "string"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "logRecord",
      "discriminator": [
        48,
        87,
        176,
        202,
        109,
        11,
        253,
        128
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "deviceIdTooLong",
      "msg": "device_id exceeds 64 bytes"
    },
    {
      "code": 6001,
      "name": "invalidHashLength",
      "msg": "sha256 must be 64 hex chars"
    },
    {
      "code": 6002,
      "name": "cidTooLong",
      "msg": "ipfs cid exceeds 96 bytes"
    },
    {
      "code": 6003,
      "name": "txRefTooLong",
      "msg": "tx_ref exceeds 128 bytes"
    }
  ],
  "types": [
    {
      "name": "logRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deviceId",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "sha256Hex",
            "type": "string"
          },
          {
            "name": "ipfsCid",
            "type": "string"
          },
          {
            "name": "txRef",
            "type": "string"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
