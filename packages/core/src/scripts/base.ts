/** The pattern cursor effect: a pattern layer follows the pointer (not touch) over its site. */
export const BASE_SOURCE = `document.querySelectorAll("[data-s-pattern]").forEach(function(el){var host=el.closest(".s-site");if(!host)return;host.addEventListener("pointermove",function(e){if(e.pointerType==="touch")return;var r=el.getBoundingClientRect();el.style.setProperty("--mx",e.clientX-r.left+"px");el.style.setProperty("--my",e.clientY-r.top+"px")})})`

/** Added only when the page has a popover marked open: popovers cannot start open without script. */
export const OPEN_SOURCE = `;document.querySelectorAll("[popover][data-s-open]").forEach(function(e){if(e.showPopover)e.showPopover()})`

/** Added only when the page has a hidden email address (a link with data-u and data-d): the first touch joins the address into the link and the words. */
export const EMAIL_SOURCE = `;["pointerdown","focusin","keydown","click"].map(t=>document.addEventListener(t,e=>{var a=e.target.closest&&e.target.closest("[data-u]"),m;if(a&&a.getAttribute("href")=="#"){m=a.dataset.u+"@"+a.dataset.d;a.href="mailto:"+m;if(a.textContent.indexOf("[at]")>0)a.textContent=m}},1))`
