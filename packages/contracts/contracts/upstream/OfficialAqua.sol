// SPDX-License-Identifier: LicenseRef-Degensoft-Aqua-Source-1.1
pragma solidity 0.8.30;

import { Aqua } from "@1inch/aqua/src/Aqua.sol";

/// @notice Compiles the pinned official Aqua implementation into the FirmDepth
/// artifact set for deterministic local deployment. No behavior is overridden.
contract OfficialAqua is Aqua { }
