import { installE2EHarness } from "./harness/suite";
import { registerAdapterContractSpecs } from "./specs/adapter-contract";
import { registerAntiFlickerSpecs } from "./specs/anti-flicker";
import { registerCustomizationSpecs } from "./specs/customization";
import { registerQueryNavigationSpecs } from "./specs/query-navigation";
import { registerReviewFilterSpecs } from "./specs/review-filters";
import { registerTurboDomSpecs } from "./specs/turbo-dom";

const context = installE2EHarness();

registerQueryNavigationSpecs(context);
registerTurboDomSpecs(context);
registerAdapterContractSpecs(context);
registerReviewFilterSpecs(context);
registerCustomizationSpecs(context);
registerAntiFlickerSpecs(context);
