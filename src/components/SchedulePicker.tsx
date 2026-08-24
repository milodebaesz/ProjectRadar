import DatePicker, { registerLocale } from "react-datepicker";
import { nl } from "date-fns/locale/nl";
import "react-datepicker/dist/react-datepicker.css";
import { formatScheduled } from "../lib/format";

registerLocale("nl", nl);

interface Props {
  value?: string; // ISO-datetime
  onChange: (iso: string | undefined) => void;
}

/** Datum/tijd-kiezer voor het inplannen van een automatische sprint-start. */
export default function SchedulePicker({ value, onChange }: Props) {
  const selected = value ? new Date(value) : null;
  const scheduled = value && !Number.isNaN(selected?.getTime());

  return (
    <DatePicker
      selected={selected && !Number.isNaN(selected.getTime()) ? selected : null}
      onChange={(date: Date | null) => onChange(date ? date.toISOString() : undefined)}
      showTimeSelect
      timeIntervals={15}
      timeFormat="HH:mm"
      dateFormat="d MMM, HH:mm"
      locale="nl"
      isClearable
      withPortal
      placeholderText="Plan automatische start…"
      className={`ph-schedule-input${scheduled ? " set" : ""}`}
      calendarClassName="pr-datepicker"
      popperClassName="pr-datepicker-popper"
      title={
        scheduled && selected
          ? `Claude pakt deze sprint automatisch op op ${formatScheduled(value!)} — ProjectRadar moet dan open staan`
          : "Plan een automatische start: Claude pakt deze sprint dan zelf op — ProjectRadar moet op dat moment open staan"
      }
    />
  );
}
