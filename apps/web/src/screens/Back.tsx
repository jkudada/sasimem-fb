/** The way back up, at the top of every setup screen. */
export const Back = (props: { href: string; label: string }) => <a class="back" href={props.href}>← {props.label}</a>;
