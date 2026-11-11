import { installE2EHarness } from "./harness/suite";
import { registerE2ESpecs } from "./harness/spec-registration";

const context = installE2EHarness();

await registerE2ESpecs(context);
