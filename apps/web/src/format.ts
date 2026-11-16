/** "10/11/2026, 10:57:23 pm", as in the redesign. */
export const formatDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { hour12: true })
