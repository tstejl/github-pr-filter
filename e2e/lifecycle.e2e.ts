import { installE2EHarness } from "./harness/suite";
import { registerAdapterContractSpecs } from "./specs/adapter-contract";
import { registerAntiFlickerSpecs } from "./specs/anti-flicker";
import { registerCustomizationSpecs } from "./specs/customization";
import { registerQueryNavigationSpecs } from "./specs/query-navigation";
import { registerReviewFilterSpecs } from "./specs/review-filters";
import { registerPreviewCompatibilitySpecs } from "./specs/preview-compatibility";
import { registerTurboDomSpecs } from "./specs/turbo-dom";
import { registerIssueSpecs } from "./specs/issues";

const context = installE2EHarness();

registerQueryNavigationSpecs(context);
registerPreviewCompatibilitySpecs(context);
registerTurboDomSpecs(context);
registerAdapterContractSpecs(context);
registerReviewFilterSpecs(context);
registerCustomizationSpecs(context);
registerAntiFlickerSpecs(context);
registerIssueSpecs(context);
