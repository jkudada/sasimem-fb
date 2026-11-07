/** Domain types shared by web and functions. Pure data - no Firebase, no DOM. */

export type UseType = "residential" | "commercial";

/** Per-line GST treatment. "inherit" follows the property's use (the UI says "same as the rent"). */
export type GstTreatment = "inherit" | "taxable" | "exempt";
