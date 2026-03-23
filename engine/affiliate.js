
fetch("../data/affiliates.json")
.then(r=>r.json())
.then(d=>{
 console.log("affiliate system loaded");
});
